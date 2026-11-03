-- A person removed from their last church keeps their account, disabled, so
-- the revisions and sets they saved still record who saved them. The account
-- gives up its username instead, so the name can be used again. NULL never
-- matches a sign-in and does not collide in users_username_lower_unique.
ALTER TABLE users ALTER COLUMN username DROP NOT NULL;
