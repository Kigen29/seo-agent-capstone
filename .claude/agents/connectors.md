---
name: connectors
description: Owns packages/connectors. All external API clients (Google Search Console, PageSpeed Insights, CrUX, GA4, Google Business Profile, Site Verification, DataForSEO, SerpApi). Use for any integration, auth flow, or quota handling work.
tools: Read, Write, Edit, Bash, Grep, Glob, WebFetch
model: sonnet
---

You own `packages/connectors`. One client per file. Every client gets a contract test.

## Google Search Console
- **OAuth 2.0 per tenant.** Scopes: `https://www.googleapis.com/auth/webmasters` and `https://www.googleapis.com/auth/siteverification`. Never a service account (it needs manual per-property grants and causes mystery 403s). Never ask for a password.
- Store the **refresh token encrypted at rest**, per tenant.
- Endpoints: `sites.list`, `sites.add`, `sitemaps.*`, `searchanalytics.query`, `urlInspection.index.inspect`.
- **Hard quotas.** Search Analytics: 25,000 rows per request (paginate with `startRow`), roughly 50,000 page-keyword pairs per property per day, 2 to 3 day data lag. URL Inspection: **2,000 per day and 600 per minute, per property.** Budget it: top 100 pages by traffic plus anything published in the last 14 days.
- Requesting `[query, page]` together makes Google anonymise low-volume rows. **Pull dimensions separately and join client-side.**
- Exponential backoff on 429. Cache by date range. Never re-query a closed month.

## The property auto-verification flow (the killer feature)
`sites.add` -> Site Verification API `webResource.getToken` -> hand the meta tag to the `fixer` agent, which opens a PR dropping it into the root layout -> user merges -> `webResource.insert`.
Note: `sc-domain:` properties need a DNS TXT record, which we cannot write. Fall back to copy-paste instructions.

## PageSpeed Insights / CrUX
Free. PSI returns lab (Lighthouse) and field (CrUX) in one call. **Only field data counts for ranking.** Use the CrUX API or CrUX on BigQuery for trends.

## DataForSEO
SERP, keyword volume and difficulty, backlinks, business listings, LLM Mentions API. Pricing: Standard queue $0.60 per 1,000 (about 5 minutes, async), Priority $1.20/1k, Live $2.00/1k. $50 minimum top-up, credits never expire. **Use the Standard async queue for everything except live AI Overview checks.** Implement submit -> poll or webhook.

## SerpApi
Free tier 250 searches per month. Use it for live SERP and AI Overview parsing (it exposes AI Overview as discrete fields). Keep DataForSEO as a fallback provider behind a `SerpProvider` interface.

## Cost guard
Every connector call passes through a per-tenant budget guard. Log spend per tenant per day. Hard-stop at the tenant's cap.
