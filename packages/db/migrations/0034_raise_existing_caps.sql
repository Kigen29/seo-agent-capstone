-- A one-off, for testing: every account that exists when this runs gets ten dollars more of paid
-- work a month (10,000,000 micro-dollars), on top of whatever cap it already had.
--
-- Added to the cap, not set to a value, so an account an operator had already raised keeps its
-- lead, and one on zero becomes ten. It touches only rows that exist now: the default for a new
-- account is the API's NEW_TENANT_BUDGET_MICROS and is not changed here, so the open deployment
-- still gives a stranger exactly what it did before.
--
-- Not reversible by rerunning: a migration runs once. To undo it, subtract the same amount.
UPDATE tenants SET monthly_budget_micros = monthly_budget_micros + 10000000;
