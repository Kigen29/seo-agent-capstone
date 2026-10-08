# ADR-0043: The web app vouches for a visitor's address

- Status: Accepted; amends a consequence of ADR-0038
- Date: 2026-10-08

## Context

The web app makes every API call from its own server. For signed-in traffic that does not matter, because limits are counted per account (ADR-0038). For anonymous traffic it does: the API sees the web server's address, so every visitor in the world shares one per-address allowance.

ADR-0038 recorded this as a known limit for the free page check: its per-address daily quota counted the web server, and only its global daily cap bounded it. One visitor running the free check a few times used up the per-address quota for everyone else. The same was true of the anonymous rate limit.

The web app knows each visitor's address. The API cannot simply be told it in a header, or anybody calling the API directly could claim a new address on every request and never be limited.

## Decision

**The web app signs the visitor's address, and the API believes only a signed one.**

- The web app adds three headers to a call it makes for an anonymous visitor: the address, the time, and an HMAC-SHA-256 of the two under a secret both sides hold (`VISITOR_ADDRESS_SECRET`).
- The API accepts the address when the signature verifies and is under five minutes old. Anything else, including an unsigned header, a header signed with another secret, or a stale one, is ignored and the API uses the address it can see.
- The accepted address is what anonymous limits are counted against: the free check's daily quota and the anonymous rate limit. The per-address **ceiling** over all traffic still counts the real connection, because that is a guard against a flood of connections and a claimed address is no use for it.
- The web app takes the visitor's address only from the headers its host sets and overwrites itself (`x-vercel-forwarded-for`, `x-real-ip`). It does not read the ordinary `x-forwarded-for`, which a visitor can write: signing an address the visitor chose would hand them the escape this closes.
- With the secret unset on either side, nothing is sent or nothing is believed, and behaviour is exactly as before. A secret shorter than 32 characters stops the API from starting.

The signing and checking are one module in `@seo/core`, on Web Crypto so the package still builds for the browser.

## Consequences

- **It does nothing until the secret is set on both hosts.** That is a deployment step, not a code change, and until it is taken the known limit from ADR-0038 still holds.
- **Anyone holding the secret can claim any address.** It is held by the web app and the API only. If it leaks, the worst outcome is the behaviour before this existed, with the global daily cap still in place, and the cure is rotating it on both hosts.
- **A captured set of headers can be replayed for five minutes**, as that same visitor's address. That gains nothing: it spends the allowance of the address it names.
- **Off the current host, the address source has to be revisited.** Another platform sets different headers. The module that reads them says which are trusted and why.
- The address is used only as a key for a counter and, for the free check, stored only as a salted hash, as it was.

## How we would know this was wrong

- Two visitors on the free check sharing one daily quota with the secret set on both hosts.
- A request with a typed, unsigned address header counted as a new visitor.
