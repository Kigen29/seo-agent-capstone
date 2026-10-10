# ADR-0044: The calendar is derived, and audits can be scheduled

- Status: Accepted; builds on ADR-0006 and ADR-0034
- Date: 2026-10-10

## Context

The product does several things on a timer. Tracked questions are put to the answer engines once a day. Each competitor is read once a week (ADR-0034). A checked fix has its search traffic looked up 31 days later, once the 28-day window either side of it has closed and Search Console has caught up.

None of that was visible. The only evidence a run had happened was a result appearing on some other page, and there was nowhere to see whether today's check had run or when the next reading was due. A person could not tell a product that was working quietly from one that had stopped.

One thing was missing outright. **An audit ran only when somebody pressed the button.** The loop the product is built on (fix, merge, verify, prove the movement) therefore stopped on the day a person stopped visiting, and a site's audit history had gaps that reflected attendance and nothing else.

There is no table of future jobs to show. That is deliberate and older than this decision: the worker is a GitHub Actions runner that wakes, asks the database who is due, does the work and exits (ADR-0006). "Who is due" is a query, such as *which site has questions and no row for today*, and that query is the entire schedule. It catches up after an outage by itself and has no state to drift.

## Decision

**1. The calendar is computed from what is stored, on every request. It is never stored.**

`buildSchedule` in `@seo/core` is a pure function. Given a site's audits, its count of tracked questions, the days already polled, each competitor's last reading and the fixes still waiting for a traffic comparison, it returns the events inside a window:

- A **past** entry is something recorded: an audit row, a day with checks, a snapshot.
- A **future** entry is what the worker's own queries will find due on that day if nothing changes.

`GET /sites/:id/schedule?month=YYYY-MM` serves it for one site and one month, in whole weeks, bounded to twelve months either side of the present.

**2. Audits can be scheduled, per site: off, every 7 days, or every 30.**

Stored as `sites.audit_cadence`, default `off`. The worker runs a sweep, `enqueueDueAudits`, at the start of every wake and before the outbox is published, so an audit found due on a wake is crawled on that wake.

**3. One function decides the day, for the page and for the worker.**

`nextAuditDay(cadence, lastAuditAt, now)` is called by `buildSchedule` and by the sweep. The day a person is shown is the day the sweep acts on, by construction and not by two implementations agreeing.

**4. Days, not times, and UTC days.**

The runner's schedule runs late and can be skipped for an hour or more under load. A time of day would be a promise nobody could keep. Every event is on a UTC day, because that is the day `visibility_checks.polled_on` keys on, and the page says so.

## Details that are easy to get wrong

- **Past days hold only what was recorded.** A day with no poll is empty, not "missed". Nothing stored says whether there were questions to ask that day, and a calendar that guessed would assert a failure it cannot show.
- **An overdue run is due today, not on a day in the past.** A late worker does the work late; it does not skip it.
- **No audit is scheduled while one is in flight.** The sweep skips a site with an audit queued or running, locks the site's row, and checks again inside the transaction that writes the new audit, so two workers waking together start one.
- **A run starts at most five scheduled audits.** The rest are still due fifteen minutes later. This spreads a day's audits over the runner's time instead of handing one runner forty crawls.
- **A scheduled audit is created exactly as `POST /audits` creates one**: a `queued` row and an `audit` job in the outbox. Progress, failure and the abandoned-audit sweep treat it like any other.
- **The calendar file is a download, not a feed.** A feed must be readable by a calendar service with no session, which means a secret in the address that shows the account to anybody who sees the link.

## Consequences

- **Off by default, so nothing changes for an existing site until somebody chooses.** A crawl is free, but an audit also embeds the site's pages for the topic map, which is paid work against the tenant's allowance. Spending on a schedule is something a person turns on.
- **A site nobody visits keeps being audited if it was left on.** That is the point of the feature and also its cost: worker minutes (free on a public repository) and a little of the allowance each time. The budget guard still applies, so an account at its cap gets an audit without a topic map, not a bill.
- **The calendar can be wrong about the future in one way: the future can change.** A competitor removed tomorrow is still on next week's calendar today. It is a statement about what will happen if nothing changes, and the page words it that way.
- **A weekly audit later in the month assumes the earlier ones ran on their days.** If one runs late, every later one moves with it. The entry says so.
- **"Monthly" is thirty days**, and the control says "Every 30 days". A calendar month would mean deciding what the 31st becomes in February, for no benefit.
- **There is no record of whether an audit was scheduled or started by hand.** The audit row does not say, and nothing downstream needs it to. If the merge and revert rates are ever compared by trigger, that is a column to add then.
- **Not shown: the worker's own housekeeping.** Reconciling pull requests, confirming Search Console verification and failing abandoned audits run on every wake and are not events in any useful sense. A calendar entry every fifteen minutes would bury the four things a person is waiting for.
