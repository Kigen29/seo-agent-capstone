-- The agent can now attempt a pull request for these rules (ADR-0030).
--
-- `fixable` is stored on each finding when its audit runs, so every finding already in the table
-- still says what was true the day it was written. Without this, the button would only appear
-- after the next audit, and a person looking at today's inbox would see no change at all.
-- Open findings only: one with a pull request or a verdict has moved past the question.
UPDATE findings
SET fixable = true
WHERE status = 'open'
  AND fixable = false
  AND rule_id IN ('TECH-006', 'TECH-011', 'TECH-019', 'TECH-020', 'TECH-023', 'TECH-024', 'TECH-025', 'TECH-026', 'TECH-027', 'TECH-028', 'TECH-032', 'AGENT-002', 'AGENT-003');
