# ADR-0025: One anonymous door, and a hard limit on what it may touch

**Status:** Accepted
**Date:** 2026-09-21
**Deciders:** Kigen
**Amends:** ADR-0009

## Context

Every page in this product is behind a bearer token, and ADR-0009 is why: the API is the only door
to the database, and the tenant is derived from a token rather than taken on somebody's word.

That decision was about *authenticated* access, and it left a gap it never argued about. A stranger
evaluating this product has to create an account before they can see it do anything, which for a
tool whose entire pitch is "we find the problem and open the pull request" is the wrong order. Rank
Report Card, the closest free competitor, understands this: paste a URL, get a result in under a
minute, no account. Its own result for `rangautiles.com` was "C, 76/100" with the explanations
behind an email gate, which is the part we are not copying.

So: can this product answer an anonymous request without weakening the property ADR-0009 exists to
protect?

The risks are specific, and worth naming before the decision rather than after:

1. **Server-side request forgery.** A stranger supplies a URL and we fetch it. That is the textbook
   shape, and a naive implementation is an internal port scanner with a public front end.
2. **Cost.** Every anonymous request spends someone's compute, and this deployment runs on a free
   tier with hard ceilings (ADR-0006).
3. **Tenancy.** An anonymous caller has no tenant, and the one thing ADR-0009 will not tolerate is
   a request that reaches tenant data without proving whose it is.

## Decision

**One anonymous route exists: `POST /check`, plus `GET /check/:id` to read back a result it
created. Nothing else is ever added to that list without amending this ADR.**

The amendment to ADR-0009 is narrow and stated precisely: the API is still the only door to the
database, and the tenant is still derived from a token and nothing else. What changes is that a
request with no token may reach exactly one handler, and **that handler may not touch tenant
data at all**.

Four constraints make that safe rather than merely stated:

- **No tenant context, ever.** The check writes to its own table, which has no `tenant_id` and no
  row-level security policy because it has nothing to scope. It cannot read `sites`, `findings`,
  `audits` or anything else. A check result belongs to whoever holds its unguessable id, which is
  a different ownership model from the rest of the product and is why it lives in its own table
  rather than as a tenant-less row in an existing one.
- **The fetch is guarded, not trusted.** One URL, `https` only, public addresses only, every
  redirect re-checked, a byte ceiling, a timeout, and no request to any address that resolves
  inside a private range. `resolveMapsUrl` in `packages/connectors/src/local/maps-url.ts` already
  follows this pattern for a user-supplied Maps link; this generalises it.
- **It is rate limited per IP and capped globally.** Per-IP limits stop one visitor from looping;
  the global daily cap is what stops a coordinated flood from spending the whole free tier. The
  global cap is the one that actually protects the deployment, because IPs are cheap.
- **It runs in the API, not on the worker, and does no crawl.** One page, its robots.txt, its
  sitemap and its llms.txt. No Playwright, no link graph, no following of internal links. The
  authenticated audit remains the thing that crawls a site, which keeps the free door cheap by
  construction rather than by policy.

**What it shows is the eight-axis breakdown, and never a single score.** This is not a style
preference. A grade out of 100 is the product decision this codebase has refused since the first
sprint (CLAUDE.md, the domain model): the axes move independently and one number hides which one is
failing. A free front door that contradicted the product's own scorecard would be advertising
something we do not sell.

**Every finding shown carries its evidence**, exactly as the authenticated inbox does. The
competitor's email gate is the part of its design we are rejecting most deliberately: a finding
whose explanation is withheld is a claim the reader cannot check.

## Consequences

### Good

- A stranger can evaluate the product in under a minute, and the strongest thing we have to show
  them is the thing they get: specific findings with the evidence attached, and an honest
  eight-axis breakdown rather than a letter.
- The sign-in prompt lands where it is true rather than where it is convenient: a fixable finding
  says a pull request could fix this, which needs a repository, which needs an account.
- ADR-0009's actual property is preserved. Anonymous and tenant data never meet, and the isolation
  is structural (a table with no tenant column) rather than a condition somebody has to remember
  to write.

### Bad

- **A public endpoint that fetches arbitrary URLs is a permanent obligation.** The guard is real
  and it is a thing that can be got wrong later by somebody adding a redirect follow or a
  convenience. It is one function, tested, and it must stay one function.
- **The free tier will sometimes say no.** A global cap means a visitor can arrive on a day when
  the answer is "come back tomorrow", which is a bad first impression and a better one than a
  bill this project cannot pay.
- **The cold start is now customer-facing.** The API sleeps and a first request has measured 33.6
  seconds. A stranger pasting a URL is the least patient reader this product has, and no amount of
  copy makes that feel fast. The page says what it is waiting for rather than pretending.
- One more table to grow and prune. Results expire after 30 days, and the prune is a job somebody
  has to keep working.

### Neutral

- The check reruns the same rule engine the audit does, so a stranger and a client see the same
  logic. The difference is coverage: no crawl, no rendered DOM, no field data unless CrUX answers
  for the origin, and the page says so rather than letting a thin check read as a clean bill.

## Alternatives considered

### Keep everything behind sign-in

The status quo, and defensible: it is the smallest attack surface and the least code. Rejected
because it makes the product unevaluable by anyone who has not already decided to trust it, and
because the demo moment this project is built around is the one thing a screenshot cannot convey.

### Put the check on Vercel instead, in a Next.js route handler

Tempting: it avoids Render's cold start entirely and the rule engine is a pure function that would
run happily there. Rejected on two counts. It would give the web app a second data path and a
second place where a public endpoint lives, which is exactly the "two ways into the system" that
ADR-0009 was written to prevent; and Vercel Hobby is for non-commercial use, so a public
acquisition funnel is the one thing that would make that plan a licensing problem rather than an
architectural one.

### Gate the explanations behind an email address, like the competitor

Rejected on principle and on evidence. A finding without its evidence is an assertion, and this
product's entire claim is that it does not make those. It would also be the second-worst version of
a lead magnet: the reader learns we found something and cannot check it, which is what makes people
distrust audit tools in the first place.

### Require a CAPTCHA rather than rate limits

Rejected for now. It moves an abuse problem onto every honest visitor, and the global cap already
bounds the damage in the way that matters, which is spend. If abuse becomes real rather than
hypothetical, this is the first thing to revisit.
