-- Correct findings that promise a fix nothing can write.
--
-- `findings.fixable` is copied from the rule that raised the finding, and the rules were corrected
-- some time after these rows were written: twelve rules declared `fixable: true` with no fixer
-- behind them, four gained one and eight became an honest `false`. The rows already in the table
-- kept the old answer, because nothing re-audits a site to repair a column.
--
-- The symptom is not cosmetic. The dashboard shows a "Fix with a PR" button for any finding whose
-- `fixable` is true, the API accepts the request, the job is queued, and the worker gets as far as
-- looking for a fixer before reporting that none exists. The user waits several minutes for a
-- failure that was certain before they clicked. That is what happened on TECH-013.
--
-- The rule ids below are the ones something can fix as of this migration: eight registered fixers
-- plus TECH-021, which the LLM content fixer writes. A literal list, because SQL cannot call
-- `canFixFinding`, and a point-in-time correction is exactly what a data migration is for. Going
-- forward the column is derived from the registry when the finding is written, so this should not
-- need a successor; if it does, that is a signal the derivation was bypassed.
--
-- Only ever narrows: a row already false stays false, and no row is made fixable by this. A false
-- negative costs a button that could have been offered. A false positive costs the user's trust.
UPDATE findings
SET fixable = false
WHERE fixable = true
  AND rule_id NOT IN (
    'TECH-002',  -- robots.txt blocks AI crawlers
    'TECH-003',  -- no sitemap declared in robots.txt
    'TECH-004',  -- page missing from the sitemap
    'TECH-005',  -- noindex on a page that should be indexed
    'TECH-007',  -- canonical points at a URL that redirects
    'TECH-015',  -- mixed content
    'TECH-021',  -- missing meta description (LLM content fixer)
    'AGENT-001', -- no llms.txt
    'LOCAL-001'  -- no LocalBusiness structured data
  );
