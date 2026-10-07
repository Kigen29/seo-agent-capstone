# ADR-0038: The API limits request rate in memory, and counts signed-in traffic by account

- Status: Accepted
- Date: 2026-10-08

## Context

A security review on 7 October 2026 found the data layer in good order and the outer edge of the API bare.

What was already in place: every query goes through Drizzle with bound parameters and Postgres row-level security (ADR-0008), session tokens are stored as SHA-256 hashes and compared in constant time, Google and hosting tokens are encrypted with AES-256-GCM, webhooks are refused without a valid signature, and every outbound fetch of a user-supplied address goes through the SSRF guard.

What was missing:

- **No rate limit anywhere** except the anonymous page check's daily quota. A signed-in script could call a model-backed route as fast as the network allowed. The monthly budget (ADR-0016) caps what that costs; it does nothing about forty model calls in one second taking the single instance down.
- **No security headers**, on the API or the web app.
- **CORS reflected any origin, with credentials**, when no origin was configured.
- No explicit request-size or request-time bound, a secret compared with `!==`, four CI workflows on the default token, and eight dependency advisories, one critical.

## Decision

### The limiter is in memory, in the API process

A fixed-window counter per key, held in a `Map`, bounded at 50,000 keys with expired windows evicted first.

The product has one Postgres and no Redis (ADR-0007), and the API is one instance, so a counter in the process is the whole truth. Counting in Postgres would turn every flood of requests into a flood of writes, which is the opposite of a defence.

### Signed-in traffic is counted by account, anonymous traffic by address

The web app calls the API from its own server, so most requests arrive from a few of the host's addresses however many people are using the product. Counting signed-in requests by address would put every customer in one bucket and let one busy account lock out the rest. So:

| Limit | Counted per | Default per minute |
|---|---|---|
| Ceiling, over everything | address | 1,200 |
| No session (sign-in, the free check) | address | 120 |
| Webhook deliveries | address | 600 |
| Everything an account does | account | 600 |
| A model call or a paid search | account and route | 12 |
| Starting queued work (an audit, a batch of pull requests) | account and route | 6 |

The account is only known after the token has been checked, so the per-account count happens after authentication. A request with a bad token is therefore counted against nobody's account: guessing at tokens cannot spend a real account's allowance. It is still held by the per-address ceiling.

Health probes are never limited, or the host would restart a healthy instance.

A refusal is a 429 with `retry-after` and `error: 'Rate Limited'`. The budget guard also answers 429, with a different `error`, and the web app shows different words for each: one means wait a minute, the other means the month's allowance is spent.

`RATE_LIMIT_SCALE` multiplies every limit by one factor, so an operator can tighten all of them during an attack without a deploy, and the proportions between them, which are the design, do not drift.

### The rest of the edge

- **Headers.** The API sends `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, a content policy of `default-src 'none'`, `Cache-Control: no-store`, and HSTS in production, on every response including refusals. The web app sends a content policy that allows scripts, styles and fonts from its own origin only, forbids framing, and drops `X-Powered-By`.
- **CORS** allows no origin unless one is named.
- **Request bounds.** Bodies are capped at 256 KB (5 MB for signed webhook deliveries, whose size a provider decides) and a request must finish arriving within 30 seconds.
- **CI.** Every workflow's token is read-only, or has no permissions at all.

## Consequences

- **A restart forgets the counts.** The instance sleeps after fifteen idle minutes, and an attacker who can make it restart gets a fresh window. This is a flood guard, not a quota. The thing that protects money is still the budget in Postgres, which survives a restart.
- **More than one instance makes the limits per instance.** That is looser and still bounded. Scaling the API beyond one instance is the trigger to move the counters to a shared store, and it is recorded here so nobody discovers it in production.
- **The web content policy allows inline scripts.** Next writes its bootstrap inline, and the theme is set by an inline script before first paint. The strict alternative is a nonce per request, which forces every page to render on demand, including the landing page, which is static on purpose. What the policy still guarantees is that no script loads from another origin. Moving to nonces is the upgrade path.
- **The free page check's per-address quota still counts the web server's address**, not the visitor's, because the web app makes that call. Its global daily cap is what actually bounds it. Forwarding the visitor's address in a way the API can trust is separate work.
- **The limits are off unless passed in.** `buildApp` takes them as an option and the server always passes the defaults, so the test suites, which add forty sites in a second, are not fighting the limiter. The browser suite runs with them on, widened.
- **Not volumetric protection.** A limiter in the process cannot help once packets are saturating the link. That is the platform's job: the API sits behind the host's edge network, which absorbs that class of attack before it reaches the process.

## How we would know this was wrong

- A real person, using a browser, sees "too many requests".
- One account's traffic causes a 429 for a different account.
- The process's memory grows with the number of distinct callers.
- A page of the web app stops working and the browser console shows a content policy refusal.
