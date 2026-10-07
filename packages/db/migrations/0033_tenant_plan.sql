-- The plan a tenant is on (ADR-0036).
--
-- A plan changes one thing, the monthly cap on paid work, and that cap already lives on this row
-- as monthly_budget_micros. So the plan is a label beside the number it set: it is what the
-- account page shows, and what a cancelled subscription is compared against. Every existing
-- tenant is on the free plan, which is what the default says.
ALTER TABLE tenants
  ADD COLUMN plan text NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'growth', 'agency'));
