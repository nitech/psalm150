-- Account links: an owner makes a one-time link instead of choosing
-- someone's password. An `invite` link lets a new person pick their own
-- username and password and joins them to the church with `role`; a
-- `reset` link lets one person (`user_id`) choose a new password. Only the
-- SHA-256 hash of the link's token is kept. A link works once
-- (`used_at`), until `expires_at`, and until it is revoked.
CREATE TABLE account_links (
    id UUID PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('invite', 'reset')),
    church_id UUID NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
    token_hash CHAR(64) NOT NULL UNIQUE,
    -- invite: the role they get and the name the owner gave them.
    role TEXT CHECK (role IN ('owner', 'leader', 'viewer')),
    display_name TEXT,
    -- reset: whose password it sets.
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    CHECK ((kind = 'invite' AND role IS NOT NULL AND user_id IS NULL)
        OR (kind = 'reset' AND user_id IS NOT NULL AND role IS NULL))
);

CREATE INDEX account_links_church_idx
    ON account_links (church_id) WHERE used_at IS NULL AND revoked_at IS NULL;
