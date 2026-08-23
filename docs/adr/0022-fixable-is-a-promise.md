# ADR-0022: `fixable` is a promise, and a failed fix has to say so

**Status:** Accepted
**Date:** 2026-08-23
**Deciders:** Kigen

## Context

A finding carries `fixable: boolean`. When it is true, the dashboard renders a "Fix with a PR" button, the API accepts `POST /findings/:id/fix` and returns 202, and the worker is expected to produce a pull request.

`TECH-006` (an indexable page with no canonical) declared `fixable: true` and had no fixer. What a user got: a button, a 202, a dashboard reading "the agent is opening a pull request", and then nothing. The worker found no registered fixer, fell through to the LLM content fixer which returns null for anything but `TECH-021`, threw, and wrote the reason to a GitHub Actions log the user cannot see. The finding stayed `open`, indistinguishable in the inbox from one nobody had touched.

Writing the test for that turned one bug into thirteen. Of the eighteen rules declaring themselves fixable, **six can actually be fixed**: five deterministic fixers and one LLM fallback. Nothing caught it because the two halves never meet. The rule engine knows nothing about the write path, correctly, because ADR-0001 keeps detection free of it. The fixers know nothing about the rule registry. `fixable` is a boolean sitting between two packages that never compare notes.

Then there was the question of whether `TECH-006` should have a fixer at all. It should not, and the reason is about canonicals rather than about effort. A canonical must be self-referencing per page, and **every file a head-tag fixer can write into is a shared layout**: `app/layout.tsx`, `header.php`, `layouts/_default/baseof.html`, a SPA's single `index.html`. A static `<link rel="canonical">` in any of them gives every route the same canonical, which tells Google that the entire site is a duplicate of one page. That is materially worse than the missing tag being reported.

Next.js looked like an escape and is not. Its documentation is explicit that a relative `alternates.canonical` resolves against `metadataBase`, not against the current pathname: `'./'` in a root layout yields the site root on every route. There is no static value that self-references.

## Decision

**`TECH-006` is `fixable: false`.** The finding now carries the guidance the button used to imply: fix it per page, and a tag in a shared layout would be wrong.

**A failed fix attempt is recorded on the finding**, in a `fix_error` column, and shown in the inbox as a badge and on the finding page as the reason. It is cleared on a successful fix. A column rather than a new `finding_status` value, because a failed attempt does not move the finding along its lifecycle: it is still open, still needs doing, and trying again is reasonable. What changed is that we owe the user an explanation, and an explanation is a fact about the finding rather than a stage of it.

**A test compares the rule registry against the fixer registry**, so `fixable: true` with nothing able to honour it fails CI. The twelve rules currently in that state are listed explicitly in the test as a ratchet: it fails if a new one joins, and it fails if one is fixed and left in the list, so the list can only shrink.

## Consequences

### Good

- The user-visible lie is gone. `TECH-006` no longer offers a button, and the finding says what to do instead of implying the agent will do it.
- **Every remaining broken promise now explains itself.** The twelve rules still declaring fixable without a fixer will fail, but they fail *out loud*, on the finding, where the person who clicked can read why.
- The gap between the two registries can no longer widen silently. It was invisible for two sprints; it is now a red test.
- The twelve are documented rather than discovered. Some want a fixer that would be easy (`TECH-003`, declaring the sitemap in robots.txt); some are editorial judgements a parser cannot make (`TECH-013`, which page should link to an orphan). Naming which is which is most of the work of fixing them.

### Bad

- **Twelve broken promises remain.** They are surfaced rather than removed, and a user can still click a button that fails. Flipping all twelve to `fixable: false` would have been quicker and would have deleted legitimate roadmap intent; building twelve fixers is a sprint. The ratchet is the compromise and it is a compromise.
- `KNOWN_GAPS` is a list in a test file, which is a weaker home than a rule property. It is there because a rule that recorded "fixable in principle, no fixer yet" would be inventing a third state for the type system to carry around for one release.
- One more column on `findings`, and one more thing to clear correctly. It is cleared on success; nothing else writes it.

### Neutral

- `fixable` keeps meaning "a fixer can generate a diff", not "this is fixable in principle". `TECH-006` is fixable by a human in thirty seconds; the flag is about the agent.

## Alternatives considered

### Build the `AddCanonicalFixer` anyway

This is what the issue asked for, and it would have shipped an actively harmful feature. Every injection target is a shared layout, so the pull request would have set one canonical for the whole site. A user merging it in good faith would have told Google their entire site was a duplicate of the homepage. The correct outcome of investigating a feature is sometimes that it must not exist.

### Template-expression canonicals

The one deterministic path that would work: `{{ .Permalink }}` for Hugo, `{{ page.url | absolute_url }}` for Jekyll, an `Astro.url` expression, a `home_url()` call for WordPress. These are per-route and correct, and they are site-wide, so they are only safe once we know *every* indexable page lacks a canonical. `TECH-006` emits one finding per page and cannot say that. Adding a canonical site-wide from a single-page finding would put a second canonical on every page that already had one. This lands when the rule aggregates; it is real future work rather than a rejected idea.

### A `fix_failed` finding status

Rejected. It reads as a lifecycle stage and is not one: the finding is still open. It would also have meant an enum change every later migration has to work around, where a nullable column is additive.

### Flip all thirteen rules to `fixable: false`

Quickest, and it throws away information. Several of those rules are fixable and simply have no fixer written yet; recording them as permanently unfixable would delete the roadmap and mislead the next person as thoroughly as the current state misleads the user.
