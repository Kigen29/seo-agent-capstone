# ADR-0023: Social sign-in mints an API token, rather than introducing a session

Date: 2026-09-16
Status: Accepted

## Context

Until now the only way into the dashboard was to paste an API token minted by
`pnpm --filter @seo/api mint-token`. That is a real credential and a real session, and it is not
something a marketer will ever do. `apps/web/lib/session.ts` has said so since sprint 1, and named
the intended fix: sign in with GitHub, using the App we need anyway to open pull requests.

The obvious way to add social login is to bring in a session library, a `sessions` table, a session
cookie, and a second code path through authentication. That would mean the API has two kinds of
caller: one presenting a session and one presenting a bearer token. Every authorisation decision in
the product hangs off `tenantForToken`, which is the single hinge that makes row-level security
real (ADR-0008), and a second way to become a tenant is a second place that hinge can be got wrong.

Three things also had to be decided, and none of them is obvious:

- The API (Render) and the web app (Vercel) are on different registrable domains, so the API
  **cannot set the web app's cookie**.
- The deployment is public and its API keys belong to the author, so anyone who signs in can spend
  them.
- A sign-in has no tenant yet, so the CSRF protection used by the Search Console flow, a state
  signed with the tenant id, has nothing to bind to.

## Decision

**A social sign-in mints an ordinary API token. It is not a new kind of session.**

The whole feature is a new way to *obtain* the credential the product already had. Nothing
downstream can tell the difference: `tenantForToken` is unchanged, row-level security is unchanged,
`withTenant` is unchanged, the MCP server is unchanged, and every token minted before this still
works. There is one authentication path, and it is the one that was already tested.

Three supporting decisions follow.

**1. Identity is keyed on `(provider, provider_account_id)`, never on the email.** An email is a
label the user controls and can change; the provider's account id is stable for the life of the
account. Keying on the email would hand a second, empty tenant to anyone who updates their address,
and would let two people who ever shared an address collide. The email is stored to be displayed.

**2. The token crosses origins as a single-use handoff code, not in the redirect URL.** The API
redirects to the web app with a code that is worth nothing on its own; the web app's *server* posts
it back and receives the token in a response body, which goes straight into an httpOnly cookie. A
URL is written to browser history, to the next request's `Referer`, and to every proxy and server
log on the way, so putting a live credential in one writes it down in three places nobody controls.
`oauth-callbacks.ts` already refuses to put secrets in redirects; this is the same rule applied to
the session itself. The code expires in two minutes, is stored only as a SHA-256 hash, and is
consumed by a conditional `UPDATE ... WHERE consumed_at IS NULL` so that two racing redemptions
cannot both win.

**3. The sign-in state carries a nonce, and the same nonce is set as a cookie on the API's origin.**
The callback accepts only a state whose nonce matches the cookie the browser presents. This is what
closes login CSRF: an attacker can obtain a valid authorization code for their own account and feed
the victim a callback URL, but cannot write a cookie on our origin in the victim's browser, so the
nonces do not match. Without it the victim ends up signed into the attacker's account and typing
their own data into it. The cookie must be `SameSite=Lax` rather than `Strict`, because the callback
arrives as a top-level navigation from the provider's domain and `Strict` would withhold it there.

Signing out revokes the token rather than only clearing the cookie, and it revokes exactly the
presented one, so signing out of a browser does not kill the CLI token. Browser sessions older than
the cookie's own thirty-day life are swept on each sign-in, so a daily user does not leave a year of
live credentials behind them.

## Consequences

**Good.** No session library, no session table, no second authentication path, and no change to the
isolation story that took ADR-0008 to get right. Both providers were already credentialed:
`GH_APP_CLIENT_ID` and `GH_APP_CLIENT_SECRET` had been sitting unused in `.env.example` since the
App was registered, and Google reuses the OAuth client the Search Console connection already has.
A provider whose credentials are absent simply gets no button, which is the same honest degradation
every connector does.

**The cost we accepted.** Anyone with a GitHub or Google account can sign in and gets a tenant with
the default monthly cap on the author's model and SERP keys. This was a deliberate choice for a
capstone that needs to be demonstrable, and the bound on it is `NEW_TENANT_BUDGET_MICROS`: setting
it to `0` leaves every free capability working (crawl, the 26 rules, the scorecard, fix pull
requests, Search Console verification) while spending nothing. The cap is per tenant, so N signups
is N caps rather than one shared pot, which is worth knowing before the repository gets attention.

**What we did not build.** There is no membership model: one identity owns one tenant, and there is
no way to invite a colleague into an existing one. That is a real product gap and it is not a
shortcut that has to be undone, because a `tenant_members` table would sit beside
`user_identities` rather than replace it.

**The token form stays.** It is how the CLI, the MCP server and the end-to-end suite authenticate,
and it is the only way in when no provider is configured. It is behind a disclosure on the login
page, not removed.
