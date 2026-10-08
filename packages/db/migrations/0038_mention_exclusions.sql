-- Sites a client has said are not about them, kept out of their brand mentions.
--
-- A mention is confirmed by the brand name being on the page (ADR-0039). That cannot tell apart
-- two businesses with exactly the same name: both pass. Only the client knows which is theirs,
-- so this is where they say so (ADR-0042). A list of domains, like `competitors`, and for the
-- same reason: it is a fact about the business that no crawl can discover.
--
-- Additive and defaulted. An empty list changes nothing.
ALTER TABLE sites ADD COLUMN mention_exclusions text[] NOT NULL DEFAULT '{}';
