-- API tokens: a person's long-lived bearer tokens for scripts and
-- integrations. A token acts as the person who made it, in one church, with
-- at most `role`: every request takes the lower of the token's role and the
-- person's current role, so demoting, disabling or removing the person limits
-- or ends their tokens too. Only the SHA-256 hash of a token is kept.
CREATE TABLE api_tokens (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    church_id UUID NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    role TEXT NOT NULL CHECK (role IN ('owner', 'leader', 'viewer')),
    token_hash CHAR(64) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ
);

CREATE INDEX api_tokens_church_user_idx
    ON api_tokens (church_id, user_id) WHERE revoked_at IS NULL;
