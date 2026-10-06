//! Limits on wrong passwords, kept in memory.
//!
//! Signing in counts failures per username and per client address; changing
//! a password counts them per person. Each attempt counts as a failure until
//! it succeeds. Once a key holds its limit of failures within the window,
//! further attempts are refused with 429 and `Retry-After` until the oldest
//! failure leaves the window, before any password is checked. Like the remote relay this lives in one process and
//! starts empty after a restart.

use std::{
    collections::{HashMap, VecDeque},
    net::{IpAddr, SocketAddr},
    sync::Mutex,
    time::{Duration, Instant},
};

use axum::http::{HeaderMap, HeaderName};

#[derive(Clone, Copy, Debug)]
pub struct Limit {
    pub failures: usize,
    pub window: Duration,
}

const FIFTEEN_MINUTES: Duration = Duration::from_secs(15 * 60);

/// Wrong passwords for one username, from anywhere.
pub const SIGN_IN_PER_ACCOUNT: Limit = Limit {
    failures: 5,
    window: FIFTEEN_MINUTES,
};
/// Failed sign-ins from one client address, for any usernames.
pub const SIGN_IN_PER_CLIENT: Limit = Limit {
    failures: 30,
    window: FIFTEEN_MINUTES,
};
/// Wrong current passwords when someone changes their own.
pub const PASSWORD_CHANGE: Limit = Limit {
    failures: 5,
    window: FIFTEEN_MINUTES,
};

/// Sweep keys whose failures have all expired once there are this many.
const SWEEP_AT: usize = 10_000;

#[derive(Default)]
pub struct Throttle {
    failures: Mutex<HashMap<String, VecDeque<Instant>>>,
}

impl Throttle {
    /// Counts an attempt as a failure before the password is checked, so
    /// requests sent all at once cannot each pass the limit while the slow
    /// hash runs. `Err(seconds to wait)` while `key` holds `limit.failures`
    /// failures. A successful attempt is taken back with [`Self::forgive`] or
    /// [`Self::clear`].
    pub fn attempt(&self, key: &str, limit: Limit) -> Result<Instant, u64> {
        self.attempt_at(key, limit, Instant::now())
    }

    /// Takes back one attempt, which turned out to be right.
    pub fn forgive(&self, key: &str, at: Instant) {
        self.with_failures(|failures| {
            if let Some(times) = failures.get_mut(key) {
                if let Some(index) = times.iter().position(|time| *time == at) {
                    times.remove(index);
                }
                if times.is_empty() {
                    failures.remove(key);
                }
            }
        });
    }

    /// Forgets the failures, after a successful attempt.
    pub fn clear(&self, key: &str) {
        self.with_failures(|failures| {
            failures.remove(key);
        });
    }

    fn attempt_at(&self, key: &str, limit: Limit, now: Instant) -> Result<Instant, u64> {
        self.with_failures(|failures| {
            if let Some(times) = failures.get_mut(key) {
                expire(times, limit.window, now);
                if times.len() >= limit.failures {
                    let oldest = times.front().copied().unwrap_or(now);
                    let wait = (oldest + limit.window).saturating_duration_since(now);
                    return Err(wait.as_secs().max(1));
                }
            }
            record(failures, key, limit, now);
            Ok(now)
        })
    }

    fn with_failures<T>(&self, f: impl FnOnce(&mut HashMap<String, VecDeque<Instant>>) -> T) -> T {
        let mut failures = self
            .failures
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        f(&mut failures)
    }
}

fn record(
    failures: &mut HashMap<String, VecDeque<Instant>>,
    key: &str,
    limit: Limit,
    now: Instant,
) {
    if failures.len() >= SWEEP_AT {
        failures.retain(|_, times| {
            expire(times, limit.window, now);
            !times.is_empty()
        });
    }
    let times = failures.entry(key.to_string()).or_default();
    expire(times, limit.window, now);
    times.push_back(now);
    // Only the newest `limit.failures` matter.
    while times.len() > limit.failures {
        times.pop_front();
    }
}

fn expire(times: &mut VecDeque<Instant>, window: Duration, now: Instant) {
    while times
        .front()
        .is_some_and(|time| now.saturating_duration_since(*time) >= window)
    {
        times.pop_front();
    }
}

/// Where a request comes from: the last address in `header` (which the
/// reverse proxy sets, `PSA150_CLIENT_IP_HEADER`) when it is configured and
/// readable, else the connection's peer. IPv6 counts by its /64, the block one
/// home or server usually holds.
pub fn client_address(
    header: Option<&HeaderName>,
    headers: &HeaderMap,
    peer: Option<SocketAddr>,
) -> String {
    let forwarded = header
        .and_then(|name| headers.get(name))
        .and_then(|value| value.to_str().ok())
        .and_then(|value| {
            value
                .rsplit(',')
                .map(str::trim)
                .find(|part| !part.is_empty())
        })
        .and_then(|part| {
            part.parse::<IpAddr>()
                .ok()
                .or_else(|| part.parse::<SocketAddr>().ok().map(|address| address.ip()))
        });
    match forwarded.or(peer.map(|address| address.ip())) {
        Some(IpAddr::V6(address)) => match address.to_ipv4_mapped() {
            Some(v4) => v4.to_string(),
            None => {
                let [a, b, c, d, ..] = address.segments();
                format!("{a:x}:{b:x}:{c:x}:{d:x}::/64")
            }
        },
        Some(address) => address.to_string(),
        None => "unknown".into(),
    }
}

/// "in 1 minute", "in 12 minutes": how long until another try.
pub fn wait_text(seconds: u64) -> String {
    let minutes = seconds.div_ceil(60).max(1);
    if minutes == 1 {
        "in 1 minute".into()
    } else {
        format!("in {minutes} minutes")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const LIMIT: Limit = Limit {
        failures: 3,
        window: Duration::from_secs(60),
    };

    #[test]
    fn refuses_after_the_limit_until_the_oldest_failure_expires() {
        let throttle = Throttle::default();
        let start = Instant::now();
        for second in 0..3 {
            assert!(
                throttle
                    .attempt_at("a", LIMIT, start + Duration::from_secs(second * 10))
                    .is_ok()
            );
        }
        let later = start + Duration::from_secs(25);
        assert_eq!(throttle.attempt_at("a", LIMIT, later), Err(35));
        assert!(throttle.attempt_at("b", LIMIT, later).is_ok());
        // The first failure leaves the window after 60 s.
        assert!(
            throttle
                .attempt_at("a", LIMIT, start + Duration::from_secs(60))
                .is_ok()
        );
    }

    #[test]
    fn attempts_at_the_same_moment_still_stop_at_the_limit() {
        let throttle = Throttle::default();
        let now = Instant::now();
        let allowed = (0..10)
            .filter(|_| throttle.attempt_at("a", LIMIT, now).is_ok())
            .count();
        assert_eq!(allowed, 3);
    }

    #[test]
    fn success_clears_or_forgives_the_count() {
        let throttle = Throttle::default();
        let now = Instant::now();
        for _ in 0..3 {
            throttle.attempt_at("a", LIMIT, now).expect("allowed");
        }
        assert!(throttle.attempt_at("a", LIMIT, now).is_err());
        throttle.clear("a");
        assert!(throttle.attempt_at("a", LIMIT, now).is_ok());

        let first = throttle.attempt_at("b", LIMIT, now).expect("allowed");
        throttle.attempt_at("b", LIMIT, now).expect("allowed");
        throttle.forgive("b", first);
        // One left counted, so two more fit under the limit of three.
        throttle.attempt_at("b", LIMIT, now).expect("allowed");
        throttle.attempt_at("b", LIMIT, now).expect("allowed");
        assert!(throttle.attempt_at("b", LIMIT, now).is_err());
    }

    #[test]
    fn finds_the_client_address() {
        let peer = Some(SocketAddr::from(([10, 0, 0, 2], 41000)));
        let forwarded = HeaderName::from_static("x-forwarded-for");
        let mut headers = HeaderMap::new();
        headers.insert(
            &forwarded,
            "203.0.113.9, 198.51.100.7".parse().expect("header"),
        );

        // The proxy's header only counts when it is configured; then its
        // last entry, the one the proxy added, is the client.
        assert_eq!(client_address(None, &headers, peer), "10.0.0.2");
        assert_eq!(
            client_address(Some(&forwarded), &headers, peer),
            "198.51.100.7"
        );
        assert_eq!(
            client_address(Some(&forwarded), &HeaderMap::new(), peer),
            "10.0.0.2"
        );
        headers.insert(&forwarded, "not an address".parse().expect("header"));
        assert_eq!(client_address(Some(&forwarded), &headers, peer), "10.0.0.2");
        headers.insert(
            &forwarded,
            "[2001:db8:1:2:3:4:5:6]:443".parse().expect("header"),
        );
        assert_eq!(
            client_address(Some(&forwarded), &headers, peer),
            "2001:db8:1:2::/64"
        );
        let mapped = Some(SocketAddr::from((
            "::ffff:192.0.2.1".parse::<IpAddr>().expect("address"),
            1,
        )));
        assert_eq!(client_address(None, &HeaderMap::new(), mapped), "192.0.2.1");
        assert_eq!(client_address(None, &HeaderMap::new(), None), "unknown");
    }

    #[test]
    fn says_how_long_to_wait() {
        assert_eq!(wait_text(1), "in 1 minute");
        assert_eq!(wait_text(60), "in 1 minute");
        assert_eq!(wait_text(61), "in 2 minutes");
        assert_eq!(wait_text(900), "in 15 minutes");
    }
}
