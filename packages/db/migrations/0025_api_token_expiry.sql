-- Explicit token kind and expiry.
--
-- Browser sessions were recognised by their display name and expired by a rule in application
-- code. Both move into the row: `kind` says what a token is, `expires_at` says when it stops
-- working, and the auth check refuses anything past it. Hand-minted tokens keep a null expiry,
-- so nothing that works today stops working when this lands.
ALTER TABLE api_tokens
  ADD COLUMN kind text NOT NULL DEFAULT 'token' CHECK (kind IN ('session', 'token')),
  ADD COLUMN expires_at timestamptz;

-- Existing browser sessions keep exactly the thirty days they were issued with.
UPDATE api_tokens
  SET kind = 'session', expires_at = created_at + interval '30 days'
  WHERE name = 'Browser session';
