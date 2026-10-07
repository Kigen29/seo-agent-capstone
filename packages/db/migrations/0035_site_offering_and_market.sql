-- What a site offers and where its customers are, in its owner's words.
--
-- Both are free text and both are optional. They exist to make suggestions specific: competitors
-- and tracked questions drafted for "guided walking safaris" in "Kenya" are better than ones
-- drafted from a homepage title alone. Nothing is scored on them and nothing is shown publicly.
ALTER TABLE sites ADD COLUMN offering text;
--> statement-breakpoint
ALTER TABLE sites ADD COLUMN market text;
