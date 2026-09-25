-- Browser sign-in for desktops: a signed-in leader approves a desktop in the
-- web client, which hands the desktop a short-lived one-time code over a
-- loopback redirect. The desktop exchanges the code plus its PKCE verifier
-- (S256) for a normal device token. Only the SHA-256 hash of the code is kept.
CREATE TABLE desktop_auth_codes (
    code_hash CHAR(64) PRIMARY KEY,
    church_id UUID NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_name TEXT NOT NULL CHECK (length(trim(device_name)) > 0),
    code_challenge TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ
);

CREATE INDEX desktop_auth_codes_expiry_idx ON desktop_auth_codes (expires_at);
