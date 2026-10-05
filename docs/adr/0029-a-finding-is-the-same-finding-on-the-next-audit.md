# ADR-0029: A finding is the same finding on the next audit

Status: accepted, 2026-10-05.

## Context

Every audit writes its own finding rows, and the inbox shows the newest audit per site. A finding's `key` (`TECH-004#3`) is its position in one audit's output: stable while that audit is re-read, and meaningless across audits, because adding one page moves every later index.

So each audit's findings were strangers to the last one's, and that had three visible costs:

- A finding with a pull request open left the inbox on the next audit. The same issue came back as an untouched, open, fixable finding with a Fix button, which opened a second pull request for work already in flight.
- A "won't fix" decision was forgotten on every audit.
- Nothing could say how long an issue had been open, or that a verified fix had come undone.

## Decision

**A fingerprint.** Each finding carries `fingerprint = sha256(ruleId | subject)`. The subject is the first affected URL unless the rule supplies one, which it does when its URL list is not stable: a duplicate title is about the title (TECH-011), a shared canonical is about the page everything points at (TECH-023). Two findings from one rule about one subject in the same audit are told apart by an ordinal assigned in title order, so the engine's ordering cannot swap them. The fingerprint is deterministic: no lookup, no model, no stored counter (ADR-0001).

**Carried when the audit is written, and only two things.** As an audit is persisted, each finding is matched to the newest earlier finding with the same fingerprint on the same site.

- `first_seen_at` is carried forward, so an issue open since August does not look new every week.
- A `wontfix` status is carried forward. It is a person's answer about the issue, not about one audit's copy of it.

**A pull request and its outcome are not copied.** They stay on the row the pull request was opened for. The webhook, the reconciler and the verifier all find that row by its pull request URL (the shared `applyFixPrOutcome`); a second row holding the same URL would give those paths two candidates and make "which one moved" depend on query order. Instead the newer finding is *linked* to the earlier one when it is read:

| Earlier record's status | Shown on the newer finding | Fix button |
|---|---|---|
| `pr_open`, `merged` | Fix in progress, with a link to the pull request | Withheld, and the API refuses with 409 |
| `verified` | Back after a fix | Offered |
| `rejected` | Earlier fix did not work | Offered |
| `open`, `wontfix` | Nothing | As usual |

The refusal is enforced in the API, not only by hiding a button, because the MCP server and any other client call the same route.

## Consequences

- The inbox lookup is one extra query per site on the page being shown, over an index on `(site_id, fingerprint, created_at)`. It does not grow with the inbox.
- Migration 0030 backfills existing rows in SQL with the same formula. A test asserts the SQL and the TypeScript agree, because a silent disagreement would stop every earlier finding being recognised. Findings from the two rules that now name an explicit subject are recognised from their next audit on, not retroactively.
- A page that moves to a new URL is a new issue. That is the correct reading for most rules (the finding is about that address) and a known limit for the rest.
- A finding whose first affected URL changes between audits without a rule-supplied subject will not be recognised. Rules whose URL lists are unordered sets should name a subject; two do today, and the rest are per-page.
- `key` keeps its job: a stable name within one audit, which is what the verifier re-checks.

## Evidence

`packages/audit/test/run.integration.test.ts` runs two real audits of one site and asserts the same fingerprints, a carried first-seen time, a carried won't-fix, and a pull request that is linked and not copied. `apps/api/test/finding-identity.integration.test.ts` asserts the 409 while a fix is open or merged, and the fix offered again once it was rejected. `packages/audit/test/fingerprint.test.ts` covers the pure functions.
