-- Email accounts sign in with a password instead of an emailed 6-digit code.
-- The hash is scrypt (see server/munch/accounts/passwords.py); the password itself is never
-- stored. Only 'email' logins have one: Google proves who you are by itself.

ALTER TABLE auth_identities ADD COLUMN password_hash text;
ALTER TABLE auth_identities ADD CONSTRAINT auth_identities_password_only_for_email
  CHECK (password_hash IS NULL OR provider = 'email');

-- Emailed codes are gone, and so is their table (003).
DROP TABLE email_login_codes;
