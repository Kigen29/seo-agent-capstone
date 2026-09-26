# ADR-0026: Neon's six-hour restore window is the retention policy, and a weekly drill proves the way out

**Status:** Accepted
**Date:** 2026-09-26
**Deciders:** Kigen
**Builds on:** [ADR-0006](0006-free-tier-infrastructure.md) (zero cost) and [ADR-0007](0007-neon-postgres-over-supabase.md) (plain Postgres on Neon, addressed only by `DATABASE_URL`). Neither is superseded.

## Context

Until September 2026 nothing in this project had ever restored a backup. The only protection was
Neon's point-in-time history, which nobody had exercised, which lives with the same vendor and
the same account as the database it protects, and which on the Free plan keeps **six hours** of
change history, capped at 1 GB-month of changes.

Issue #201 closed half of that gap. `scripts/restore-drill.sh` dumps the database inside one
read-only snapshot, restores it into an empty Postgres, and fails unless every row count, column,
row-level security flag, policy and grant matches the snapshot. It runs against production every
Monday and against the test database on every CI run. The first production run found a real
defect (Neon's dump names its platform superuser, which a plain Postgres does not have), and the
second passed: 17 tables, 136 KB, restored in two seconds.

What the drill deliberately does not do is keep anything. The repository is public, so the dump
is written to the runner's temporary disk and destroyed with it. The drill proves the data **can**
be carried out of Neon and brought back anywhere; it is not a copy that survives.

That leaves one question this ADR answers: should the project retain backups older than Neon's six
hours, and if so, where?

The forces:

1. **Budget.** ADR-0006 fixes infrastructure cost at zero. Neon's longer restore windows are paid.
2. **The repository is public.** Anything GitHub Actions stores as an artifact on a public
   repository can be downloaded by any signed-in GitHub user. A retained dump there must be
   encrypted, and its safety then rests entirely on one passphrase.
3. **What the data is.** Most of it can be rebuilt: crawls re-run, findings and scorecards
   regenerate from them, and OAuth connections are restored by the user signing in again. Some of
   it cannot: accounts and identities, the spend ledger, and the AI-visibility poll history, a
   time series of citations observed on specific days that no later poll can recreate.
4. **Who the data belongs to.** At the time of writing the deployment holds demo tenants and the
   author's own sites. There is no paying customer and no service-level promise.

## Decision

**Neon's Free restore window is the only retained recovery point. The project does not keep
off-vendor copies of the database.** Portability is proved every week by the restore drill instead
of being stored as a file.

Three operating rules make that an explicit policy rather than an accident:

- **Damage noticed within six hours is restored with Neon's instant restore** (branch from a
  timestamp before the damage, verify it, then promote it or copy the lost rows back).
- **Damage noticed later than six hours is accepted as loss.** Re-derivable data is rebuilt by
  re-running audits; poll history and ledger rows from the lost interval are gone, and the incident
  note says so.
- **Before any destructive change, take a named restore point by hand.** A destructive migration
  (the migrate workflow already requires a two-phase plan and an ADR for one) or a bulk data fix
  starts by creating a Neon branch named `pre-<change>` from the production branch. The history
  window limits how far back a branch can be created from, not how long an existing branch keeps
  its data, so the branch outlives the six hours. Branches are free on the Free plan but count
  against its ten-branch and 0.5 GB project limits, so the branch is deleted once the change is
  verified. Planned risk gets a recovery point that outlives the window; only
  unplanned damage relies on the six hours.

The weekly drill keeps its current shape and stays mandatory: it is the evidence that the
`DATABASE_URL` seam from ADR-0007 is real, and that if Neon disappeared tomorrow the data could be
restored on any Postgres with `pg_restore` and one role.

## Consequences

### Good

- **Zero cost and zero new services**, consistent with ADR-0006. No second vendor, no second
  credential, no artifact storage to police.
- **No copy of user data sits in public-repository storage**, encrypted or otherwise. Nothing
  depends on a passphrase that could leak or be lost.
- **Recoverability is tested, not assumed.** A dump that cannot round-trip fails a scheduled run,
  or fails the pull request whose schema change broke it, before anyone needs it in an emergency.
- The policy is written down, with its failure mode stated, which is the difference between a
  risk that was accepted and a risk that was missed.

### Bad

- **Data damage discovered more than six hours late is permanent** unless a manual restore point
  happened to cover it. For the poll history this is real loss: citation observations are tied to
  the day they were made.
- **Neon remains a single point of failure for retained data.** An account suspension, a regional
  loss or a vendor exit leaves only whatever the next drill could still dump.
- **The manual restore-point rule depends on discipline.** A destructive change made without
  creating the branch first falls back to the six-hour window.

### Neutral

- The restore drill doubles as a portability test for ADR-0007: it restores into stock
  `postgres:18`, never into Neon.
- Neon's Free history is also capped at 1 GB-month of changes, far above what this database writes,
  so the window, not the cap, is the binding limit today.

## Alternatives considered

### Encrypted weekly dumps kept as GitHub Actions artifacts (up to 90 days)
Rejected for now. It is free and would give roughly thirteen weekly recovery points, but it places
an encrypted copy of personal data (identities, a spend ledger, encrypted OAuth tokens) in storage
that any signed-in GitHub user can download, so the whole protection rests on one passphrase kept
as a repository secret. If the passphrase leaks, every retained dump is readable; if it is lost,
every retained dump is useless. For demo data that trade is worse than the loss it prevents.

### Encrypted dumps in Cloudflare R2 (free tier)
Deferred, not rejected. Private object storage with no egress fees is the right home for retained
backups, and it is the migration trigger below. Today it adds a second vendor, a second credential
and a key-management duty to protect data that is mostly demo and mostly re-derivable.

### A paid Neon plan with a longer restore window
Rejected. It breaks the zero-cost constraint in ADR-0006, and a longer window at the same vendor
still leaves Neon as the single point of failure.

### Periodic dumps to the developer's own machine
Rejected. It is manual, so it would lapse, and it moves personal data onto a personal device
outside any access control the deployment has.

## Migration trigger

Adopt retained, encrypted, off-vendor backups (R2, with the drill restoring from the retained copy
rather than a fresh dump, so the backup that is kept is the backup that is tested) when **any** of
these becomes true:

- the first tenant who is not the author or a demo account signs up,
- any tenant pays, or any service-level promise is made,
- the AI-visibility history becomes something a customer relies on for reporting.

Until then, the restore drill (`.github/workflows/restore-drill.yml`) and the manual restore-point
rule above are the whole backup strategy, and this ADR is where that is stated.
