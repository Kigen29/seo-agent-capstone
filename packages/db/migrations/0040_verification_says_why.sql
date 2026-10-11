-- Two things that failed silently now have somewhere to be written (ADR-0048).
--
-- A Search Console verification request is carried out by the worker, minutes after the click.
-- When it failed, the failure went to the worker's log and nowhere else: the site stayed on
-- 'none', and the person who clicked saw nothing happen. `gsc_verification_error` holds the
-- reason, in words of our own, until the next attempt replaces or clears it.
--
-- And a Google connection can die while still looking connected. Google rejects the saved
-- refresh token when access is revoked, and after seven days for an OAuth client still in
-- testing. The credential row is still there, so the dashboard said "connected".
-- `needs_reconnect_at` is set when Google refuses the token and cleared when the person
-- connects again.
--
-- Both additive and nullable. Null is the state of everything that already exists.
ALTER TABLE sites ADD COLUMN gsc_verification_error text;
ALTER TABLE oauth_credentials ADD COLUMN needs_reconnect_at timestamptz;
