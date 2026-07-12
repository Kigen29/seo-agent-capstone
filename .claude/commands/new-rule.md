---
description: Scaffold a new deterministic SEO rule with tests and fixtures
argument-hint: <RULE-ID> <short description>
allowed-tools: Read, Write, Edit, Bash, Glob
---

Use the `rule-engine` sub-agent.

Create a new rule `$1`: $2

Produce exactly four files:
1. `packages/rules/src/<namespace>/$1-<slug>.ts` - the pure rule function
2. `packages/rules/test/<namespace>/$1.test.ts` - Vitest test
3. `packages/rules/test/fixtures/$1-triggers.html` - a page that triggers it
4. `packages/rules/test/fixtures/$1-clean.html` - a page that does not

The rule MUST populate `falsification`. If you cannot state how we would know the fix failed, stop and tell me the rule is not ready.

Register the rule in `packages/rules/src/registry.ts`.
Run `pnpm --filter @seo/rules test` and show me the output.
