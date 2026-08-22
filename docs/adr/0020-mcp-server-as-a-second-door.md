# ADR-0020: The MCP server is a second door, and it goes through the API

**Status:** Accepted
**Date:** 2026-08-23
**Deciders:** Kigen

## Context

The products this one is measured against have converged on a shape. [OpenSEO](https://github.com/every-app/open-seo), the closest open-source comparable, consolidates six workflows (keyword research, rank tracking, competitor analysis, backlink research, site auditing, AI search visibility) and publishes them as an **MCP server**, so Claude Code, Cursor and Codex can pull SEO data straight into a coding session. That is the right instinct: the person who can act on a technical SEO finding is usually sitting in an editor, not a marketing dashboard.

It is also, for them, where the story stops. OpenSEO hands an agent data. It has no repository connection, no framework detection, no fixer registry and no verify-on-merge loop, so an agent holding its output still has to write the fix itself, from a description.

We have all four, and until now they were reachable only by clicking a button in our own dashboard. The asymmetry was pointing the wrong way: our differentiator was locked inside the one surface an agent cannot use.

The forces:

- **The write path must stay behind the same guarantees.** Nothing may reach a default branch (rule 2), every change must arrive as a pull request carrying its evidence and rollback note (rule 4), and tenant isolation must not weaken because a new caller appeared.
- **A tool call is not a button press.** A human clicks "Fix with a PR" once and waits. A model can call the same thing forty times in a loop. The danger is not that any one pull request is wrong; it is that forty correct ones are still a bad afternoon for whoever reviews them.
- **It has to be free** (ADR-0006). Render's free tier fits one web service and the API already occupies it.
- **The database has exactly one door** (ADR-0009), and that was hard-won: the web app was one commit from reading Postgres out of a server component, which would have put the `BYPASSRLS` owner credential into Vercel's environment.

## Decision

We will ship an MCP server as `apps/mcp`, a **stdio** server that talks to the REST API over HTTP through `@seo/api-client` and **holds no database handle**.

It exposes five read tools (`list_sites`, `list_findings`, `get_finding`, `get_audit`, `audit_status`) and three write tools (`run_audit`, `fix_finding`, `verify_site`). `fix_finding` opens a real pull request; `verify_site` opens the Search Console verification pull request.

The write tools are governed by two independent controls:

1. **`SEO_MCP_ALLOW_WRITES=1` or they are not registered at all.** Absent, not present-and-refusing.
2. **A per-process pull-request cap** (`SEO_MCP_MAX_PRS`, default 3), shared between `fix_finding` and `verify_site`, checked *before* the call and not consumed by a failed one.

Authentication is the existing bearer token. Tenancy therefore needs no new code: the token resolves to a tenant and row-level security does the rest.

## Consequences

### Good

- **The differentiator is now addressable by an agent.** An editor can go from "audit this site" to an open pull request without a human touching the dashboard. No competitor on the MCP shelf can do the last step, because none of them has the repo.
- **ADR-0009 is enforced mechanically rather than remembered.** `apps/mcp` is deliberately absent from the `DB_RULE` allow-list in `eslint.config.mjs`, so a future version of this server that tried to shortcut past the API fails CI. The architecture defends itself against its own author.
- **Zero cost.** stdio means the server is a child process on the user's machine. No second service, no eviction of the API, ADR-0006 intact.
- **No new authentication surface.** Reusing the bearer token means there is no second way to become a tenant, which is the property that made row-level security worth the trouble.
- Refusing to register write tools rather than refusing to run them means a model never spends a turn discovering it is not allowed, and never reports to a user that the agent "refused" when nobody had enabled writes.

### Bad

- **stdio means local only.** A hosted client cannot reach it; the user must be able to run Node. That closes off a browser-based agent until there is money for a second service.
- **The cap is per-process and not persisted.** Restarting the server resets it. That is a deliberate limit on how much this guard rail claims to be: it stops a runaway loop, it is not a quota.
- **A fourth consumer of the API's response shapes.** The dashboard, the tests, the typed client and now the tool formatters all care when a route changes shape. The typed client is what keeps that to a compile error rather than a runtime surprise.

### Neutral

- Tool output is prose rather than JSON. It is read by a model, and the list renderers deliberately emit counts where the detail renderer emits URLs, because context is paid for by the token.

## Alternatives considered

### An HTTP or SSE transport, hosted alongside the API

Rejected on cost, and it would have been the wrong default anyway. Render's free tier fits one web service, so this meant paying or evicting the API. A hosted MCP endpoint also needs its own authentication story for a token travelling over the network to a shared host, where stdio hands the token to a process the user already trusts on a machine they already control.

### Letting the MCP server talk to Postgres directly

Rejected, and the reasoning is ADR-0009 unchanged. It would have been faster and it would have meant a second thing holding the owner credential, a second place tenant isolation could be got wrong, and an architecture document that no longer described the system. The ESLint rule makes it fail CI, which is the correct amount of difficulty.

### Read-only tools first, writes in a follow-up

Rejected as the safest way to ship the least interesting half. The read tools are the part every competitor already has. Shipping them alone would have been a month of work to achieve parity with a free tool, while the thing that makes this product worth building sat behind a dashboard button for another sprint.

### No cap, on the grounds that the pull request is already the gate

Genuinely arguable, and it is what the REST API does today. Rejected because the gate answers a different question. The PR gate ensures nothing bad is *merged*; it says nothing about how much arrives for review. The dossier already names blast-radius limiting as the mitigation for an agent writing code, and a loop is exactly the case where a per-call human decision is missing.
