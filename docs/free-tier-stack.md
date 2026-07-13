# The Free Tier Stack

Everything below is genuinely free, permanently, at capstone scale. Total out of pocket: **$0**, plus whatever OpenAI credit you already have.

Three decisions do most of the work:

1. **Make the capstone repo public.** The Quantic handbook explicitly allows it and even encourages it ("with the option to make it public... showcase your engineering skills to potential employers"). Public repos get **unlimited free GitHub Actions minutes**. That single fact turns GitHub into your free worker fleet.
2. **Drop Redis. Use Postgres as the queue.** `pg-boss` gives you a durable job queue, scheduling, retries, and dead-letter handling on top of the Postgres you already have. One less service, one less free tier to babysit, and the free Redis tiers (Upstash: 10,000 commands/day) would have throttled a single 500-page crawl anyway.
3. **One Postgres, and nothing else. No platform, no object store.** Data, the job queue, the vector store, and the compressed crawl artefacts all live in the same database, addressed only by `DATABASE_URL`. There is no vendor SDK anywhere in the repo, so the host is a commodity you can swap in an env var. See ADR-0007.

---

## Infrastructure

| Layer | Choice | Free tier reality | Notes |
|---|---|---|---|
| **Database** | **Neon** Postgres | ~0.5 GB, **does not pause on idle** | Plain Postgres. No vendor SDK, no service-role key: the integration surface is `DATABASE_URL` and nothing else. Supabase was the original pick and was dropped because its free tier pauses a project after 7 days idle, and a paused database is a failed demo. ADR-0007. |
| **Job queue** | **pg-boss** on the same Postgres | free | No Redis. No second service. Durable, scheduled, retryable. |
| **Artefact storage** | **The same Postgres**, compressed | shares the ~0.5 GB | Crawl artefacts: HTML, screenshots. Prune hard, keep only the latest crawl per site. Blobs in Postgres do not scale and we know it; the documented trigger to move to Cloudflare R2 is ~300 MB. |
| **Vector store** | **pgvector** in the same Postgres | free | For internal-link relevance and content gap analysis. |
| **Web app** | **Vercel** Hobby | free, non-commercial | Next.js. Perfect fit. |
| **API** | **Render** free web service | free, spins down after 15 min idle, cold start ~30s | Acceptable for a demo. Add a `/health` ping if the cold start annoys you. |
| **Workers (crawls, audits, polls)** | **GitHub Actions** on a public repo | **unlimited minutes** | This is the unlock. See below. |
| **Auth** | **Auth.js** with GitHub OAuth | free | The users are developers connecting a repo, so GitHub is the identity they already have. |
| **Email** | **Resend** | 3,000/month free | Weekly digest emails. |
| **CI** | GitHub Actions | free (public repo) | lint, typecheck, test, build |

## Workers on GitHub Actions (the trick)

A 500-page Playwright crawl will not run on a Render free web service. But it runs beautifully in a GitHub Actions job, which already has Chromium available, has no execution-time pressure at 6 hours per job, and costs nothing on a public repo.

```
apps/api (Render, free)
  -> enqueues job in pg-boss (Postgres)
  -> fires repository_dispatch to GitHub
      -> Actions runner spins up
      -> claims the job, runs the crawl / audit / AI poll
      -> writes results back to Postgres
      -> marks the job complete
```

You get the same job semantics, you keep pg-boss as the source of truth, and the heavy compute is free and ephemeral. It also happens to be a genuinely interesting architectural decision to defend in the design document.

Scheduled work (the 3-day AI visibility poll, the 28-day CrUX verification window) becomes a `schedule:` cron trigger. Free.

---

## Data sources

| Source | Free tier | What you get |
|---|---|---|
| **Google Search Console API** | free, forever | Clicks, impressions, CTR, position by query and page. URL Inspection (2,000/day/property). Sitemaps. `sites.add`. |
| **Site Verification API** | free | Enables the auto-verification-by-PR feature |
| **PageSpeed Insights API** | free, 25,000 req/day with a key | Lab (Lighthouse) + field (CrUX) in one call |
| **Chrome UX Report API** | free | Field Core Web Vitals, the only data that counts for ranking |
| **CrUX on BigQuery** | free (1 TB query/month) | Origin-level CWV history |
| **Google Analytics Data API** | free | Post-click behaviour, LLM referral traffic |
| **Google Business Profile API** | free (needs approval) | Local SEO |
| **Bing Webmaster Tools API** | **free** | **Backlink data, keyword research, crawl info.** Massively underused. Free API key. This is your free backlink source. |
| **Ahrefs Webmaster Tools** | **free for sites you verify** | Backlinks and site audit for your own verified properties. Free, but only for sites you own or verify. Perfect for Code 5's own client sites. |
| **IndexNow** | free | Instant URL submission to Bing, Yandex, Naver. One HTTP call. |
| **Common Crawl** | free | Backlink graph mining if you get ambitious. Heavy. |
| **SerpApi** | 250 searches/month free | Live SERP + AI Overview as discrete fields. Ration these: 250/month is roughly 2 sites polled 3x weekly. |
| **DataForSEO** | free sandbox + $1 trial credit | Sandbox returns fake data but exercises the full integration path. Build against the sandbox, top up $50 later when you have revenue. |
| **Your own crawler** | free | Everything on-page, the link graph, schema, rendering, robots. This is 70% of the audit and it costs nothing. |

**Read that last row again.** The bulk of the product, the deterministic rule engine over your own crawl plus Search Console, costs literally zero. The paid data (SERP volumes, third-party backlink indices) is the least differentiated part of the product anyway.

**Sprint 3 ration plan for SerpApi's 250/month:** 5 tracked prompts x 3 polls x 4 weeks = 60 searches for AI visibility on one demo site. Leaves 190 for SERP checks and the demo. Enough. Set a hard counter in the budget guard.

---

## LLM

You have OpenAI credit. Use it. But route by role, and keep the free options wired up so you can fall back when the credit runs out.

| Role | What it does | Recommended | Free fallback |
|---|---|---|---|
| `fast` | Extraction, classification, summarisation. High volume. | `openai:gpt-4.1-mini` | `google:gemini-2.0-flash` (free tier in AI Studio), `groq:llama-3.3-70b-versatile` (free tier, very fast) |
| `smart` | Reasoning, code generation for fixes. Low volume, high stakes. | `openai:gpt-4.1` | `google:gemini-2.5-pro` (free tier, rate limited) |
| `embed` | Page embeddings for internal linking and content gaps | `openai:text-embedding-3-small` (very cheap) | `google:text-embedding-004` (free), or local `bge-small` via transformers.js (free, no API) |
| `judge` | Scores the eval harness | **must be a different provider than the one under test** | `google:gemini-2.5-pro` |

That last row matters. If you use OpenAI to grade OpenAI's output, you get self-preference bias and your eval harness lies to you. Use a different family as the judge. It is a defensible methodological point for the capstone.

**Cost control that actually works:** the rule engine finds the issue. The LLM only writes the fix. So you make one `smart` call per *fixable finding*, not per page. A 500-page crawl with 14 fixable findings is 14 smart calls, not 500. Your OpenAI credit will last a very long time.
