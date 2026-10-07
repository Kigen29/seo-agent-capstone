-- A one-off, by the operator's decision on 8 October 2026: settle at zero every spend reservation
-- that was still unsettled from before that day.
--
-- Each paid call reserves its worst-case cost before it runs, and a call that failed never gave
-- that back. On 8 October the deployment had 35 such holds, 1.70 dollars in all, counted against
-- a shared monthly cap of 5 dollars, and paid features were being refused with 3.30 dollars
-- actually spent. The model providers in use are on free tiers and the failures were refusals
-- (a key out of credit, a request too large for the plan), so these calls were not billed.
--
-- This is the reconciliation docs/repair-progress.md says an operator must do by hand: "an
-- explicit zero for a confirmed unbilled request". Since #321 a refused call releases its own
-- hold, so this clears what built up before that and should not need repeating.
--
-- A fixed cutoff, not "older than an hour": a migration also runs on every fresh database, and a
-- fixed date makes it do nothing there. No call was in flight across the cutoff; the newest hold
-- it touches was made on 7 October.
--
-- Nothing is deleted. Each row stays, marked settled with an actual cost of zero, so the ledger
-- still shows that the call was attempted and what was held for it.
UPDATE spend_reservations
SET settled_at = now(), actual_micros = 0
WHERE settled_at IS NULL
  AND created_at < TIMESTAMPTZ '2026-10-08 00:00:00+00';
