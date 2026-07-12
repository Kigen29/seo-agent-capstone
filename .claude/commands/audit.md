---
description: Run a full local audit against a URL using the current rule engine
argument-hint: <url>
allowed-tools: Bash, Read, Grep, Glob
---

Run a full audit against $1 using the local rule engine.

1. `pnpm --filter @seo/crawler crawl -- --url $1 --max-pages 100`
2. `pnpm --filter @seo/rules evaluate -- --crawl latest`
3. Print the eight-axis scorecard and the top 10 findings sorted by priority score.
4. For each fixable finding, state which framework-specific fixer would handle it.

Do not open any pull requests. This is a read-only dry run.
