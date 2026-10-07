# ADR-0034: Competitor watch reports the order of events, never a cause

Status: accepted, 2026-10-07.

## Context

STORY-053 (#172) is Tier 3 item 10 of `docs/competitive-research-heytony.md`. The product it answers is a watcher that snapshots up to three competitors weekly and diffs their titles, meta descriptions, headings and links. That is useful and it stops at "this changed".

We already hold the other half. The worker polls the answer engines daily for every tracked question and records, per check, which of the site's configured competitors the answer cited (`visibility_checks.cited_competitors`). So a change to a competitor's page can be set beside what their citations did around it.

Three things constrain how:

- **The worker is a throttled cron.** `docs/state-of-play.md` records it as declared every 15 minutes with a median near three hours. Anything that must happen on a particular day will sometimes not.
- **One free-tier Postgres holds everything** (ADR-0007). Storage that grows with time rather than with the number of things tracked is storage that eventually has to be paid for.
- **A competitor's hostname is text a tenant typed.** Fetching it is the same risk as fetching a URL a stranger types into the public check (ADR-0025).

And one thing constrains what may be said. A change followed by a citation gain is the most persuasive screen this product could show and the least supported. Engines' answers move day to day on their own (about 45% of citations appear in only one of three checks), and a competitor who rewrote one page probably changed several other things in the same week.

## Decision

**A snapshot is what a parser reads off served HTML, and nothing else.** For each competitor: the title, meta description and first H1 of the homepage and up to eleven sitemap pages (`MAX_WATCHED_PAGES` is 12), and the list of URLs their sitemap declares on their own host. No model is involved at any point. Whether something changed is a string comparison after collapsing whitespace. This is rule 1 applied to somebody else's site.

**The same pages are read every week.** Pages are chosen from the sitemap shallowest path first, then alphabetically, so the choice is a function of their sitemap and not of the run. A page read this week and not last week is not reported as changed.

**The diff refuses three things.** A week that could not be read is never diffed, so an outage cannot read as "everything changed". The first sighting of a sitemap reports no new URLs, because they are new to us and not to them. New URLs are capped at 50 per diff, because a relaunch is not fifty thousand pieces of news and each one is a stored row.

**A sweep, not a queue.** `watchCompetitors` asks which tracked competitors have no snapshot newer than seven days and reads up to six of them, never-read first and then longest-waiting. A run that comes late does the work late; a run that comes twice finds nothing due. Nothing is enqueued for a day that the cron may skip. It runs in the worker's drain under its own scope, `watch-competitors`, and a failure is logged and swallowed so that somebody else's site being down cannot fail the run that carries audits and fixes.

**Storage is bounded by what is tracked, not by time.** Two tables with two lifetimes. `competitor_snapshots` holds gzipped JSON and exists only to diff the next snapshot against, so every write deletes all but the newest two for that competitor, and the rows of a competitor removed from the site's list. `competitor_changes` holds the small rows a person reads and is pruned at 180 days. Both carry `tenant_id` under forced row-level security like every other table.

**Every fetch goes through `publicFetch`, and their robots.txt is honoured.** The SSRF guard stays one function: DNS resolved before fetching, private addresses refused, every redirect re-checked, bytes and time capped. Before reading anything the sweep reads the competitor's robots.txt and, if it disallows the user agent `publicFetch` identifies as, records that as the snapshot's note and reads nothing. Requests are sequential: a dozen in a burst is how a visit starts to look like a probe.

**The read route fetches nothing.** `GET /sites/:id/competitor-watch` returns what the sweep has written. There is no "refresh now", because an authenticated request that makes our servers call a hostname the caller chose, on demand, is a request forgery primitive with a nicer name.

**Citations are counts either side of a date.** For each batch of changes (one competitor, one snapshot) the report gives that competitor's citations in the seven days before the change was detected and the seven days from it: how many checks named them, out of how many ran. The correlation is at the level of the competitor, not of a single question, because the sample for one question in one week is two or three checks.

**The page states an order and denies a mechanism.** The sentence is built by one function, `citationSentence`, with a test that fails if it ever contains a causal word or a percentage. It says "cited in 2 of 16 checks in the 7 days before, and cited in 3 of 26 checks in the 7 days after", adds "so far" while the after-window is still running, says "no checks ran" instead of "0 of 0", and is always followed by the same note: one followed the other, which is a coincidence in time and not evidence of a cause. No lift, delta or percentage change is computed anywhere, so there is no figure for a reader to quote as one.

## Consequences

- The story's falsification condition ("the page claims a competitor's change caused a citation gain") is enforced by a unit test on the only function that writes that sentence, not by a reviewer remembering it.
- A change is dated to when it was seen, which is up to a week after it was made, and later still when the cron is slow. The page says so. The before and after windows are therefore approximate at the edges, which is one more reason they are presented as context and not as a measurement.
- Six competitors per run, a dozen sequential requests each with an eight-second timeout, is a worst case of about ten minutes inside a sixty-minute job. With more tracked competitors than that, each still gets read weekly as long as runs arrive more often than the backlog grows; if they do not, snapshots are late and nothing is lost.
- A competitor who blocks us in robots.txt is simply not watched, and the page says that is why. We do not offer a way around it.
- Only served HTML is read. A competitor whose titles are set by JavaScript will show the pre-render title, consistently, so a real change may be missed. Rendering their pages in Chromium every week was rejected as far too heavy a visit for what it buys.
- Removing a competitor from a site's list removes its snapshots on the next sweep of that site. Its past changes stay until retention prunes them, because they are history the person already saw.
- Migration 0032 adds both tables. Like every migration since 0006 it is hand-written and registered by hand in the journal.

## Alternatives considered

- **A `pg-boss` job per competitor per week.** Rejected: it adds a schedule that the cron cannot keep, and a queue to drain, to do something a single query ("who is overdue?") does without either.
- **Keeping every snapshot.** Rejected: the only reader of an old snapshot is the next diff. The changes are the history, and they are a fraction of the size.
- **Asking a model to summarise what the competitor changed.** Rejected: it would make a model the detector, and a fluent paragraph about a competitor's strategy is precisely the unfalsifiable advice rule 3 bans.
- **Correlating per tracked question** ("they rewrote pricing and started being cited for the pricing question"). Deferred, not rejected. It is the sharper claim and it needs a week's sample per question that a daily poll on two engines does not yet give. When the sample exists, it must go through the same sentence builder.
- **A refresh button.** Rejected above, as a way to make the API fetch a caller-chosen host on demand.

## Evidence

- `packages/audit/test/competitors.test.ts`: the diff's three refusals, the citation windows, and the snapshot reader against a fake site, including that a robots.txt disallow results in exactly one request.
- `packages/audit/test/competitors.integration.test.ts`: the sweep over three weeks against Postgres, that two snapshots remain however many weeks pass, and that another tenant sees neither the report nor the rows.
- `apps/web/lib/citation-sentence.test.ts`: the wording, including the test named for the falsification condition.
