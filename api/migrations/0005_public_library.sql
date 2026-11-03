-- An owner may open the church's library to anyone, read only.
ALTER TABLE churches ADD COLUMN public_library BOOLEAN NOT NULL DEFAULT false;
