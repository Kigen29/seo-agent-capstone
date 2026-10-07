# ADR-0033: Hosting is connected by consent, and the project is found, not typed

Status: accepted, 2026-10-07. Extends ADR-0028.

## Context

ADR-0028 gave each site its own Vercel connection, which is what makes a merged fix verifiable for a customer who is not the operator. To make that connection a person had to create an access token in Vercel, find the project's id in its settings, find the team's id in the team's settings, and paste all three into a form.

In practice it did not get done. Two real sites had merged pull requests sitting at "verification inconclusive" because the step that would have verified them was three lookups in another product. The request from the person using it was direct: a button that says connect to Vercel.

Everything the form asked for is something Vercel will tell us. A registered integration has a consent screen that returns a code, exchangeable for a token scoped to what the person approved. The project that deploys a repository can be listed by repository. And ADR-0028 already had the check that matters, which is whether a project actually serves the site's address from the connected repository.

## Decision

**One button, when the operator has registered a Vercel integration.** The hosting page offers "Connect to Vercel". The API mints a state signed for the tenant and the site (the same signing as the GitHub install state) and returns Vercel's consent address. Vercel redirects back to `/connections/vercel/callback` with a code and the state. The callback verifies the state, exchanges the code, finds the project, proves it, and stores the connection.

**The project is found from the repository, by either route.** With a granted token or a pasted one, the projects linked to the site's GitHub repository are listed, and only those whose own record names that repository are considered. A project id typed into the form is still honoured, and is now optional.

**The project kept is the one that is proved.** A repository can deploy to more than one project: a staging project, a monorepo. Each candidate is checked with ADR-0028's existing test, that it serves the site's own address from the connected repository, and the first that passes is stored. If none passes, nothing is stored and the person is told which of the two things failed: no project for the repository, or a project that does not serve the address.

**Nothing in the redirect is trusted to say where a credential goes.** The site and tenant come from the signed state. The team comes from the token grant, and the team in the query string is used only when the grant names none, and only to scope a lookup. The project comes from the lookup and the proof. The token is stored exactly as before: encrypted, bound to the tenant and the site, never returned.

**One code path.** `connectVercel` validates and stores for both routes, so the three rules of ADR-0028 are enforced in one place and cannot hold for a pasted token and lapse for a granted one.

**The token form stays.** It is the only route on a deployment with no integration registered, and a fallback where consent is not possible for an account. When the button is available the form is folded away beneath it.

## Consequences

- Connecting a site's hosting is one approval for the customer. The operator pays once, by registering the integration (`docs/vercel-integration.md`) and setting four environment variables. Until then the product behaves as before, with a shorter form.
- The API holds a client secret for the integration. It lives in the host's environment, never in the repository, and is sent only in the body of the exchange.
- A granted token has the access the person approved on Vercel's screen, which may be more than one project. We use it for one: reading deployment state for the project stored against the site.
- After connecting, the person lands on our hosting page with the result, not on Vercel's dashboard. Vercel offers a `next` address to return to; it is not followed, because what the person asked for was to connect the site they were looking at.
- If a customer removes the integration in Vercel, the token stops working and the next verification reports it, as a revoked pasted token already does.
- Hosts other than Vercel are unchanged: GitHub deployment reports, no credential.

## Evidence

`packages/vcs/test/vercel-connect.test.ts` is the contract test for the exchange and the listing: the endpoints, the secret in the body and never the address, both shapes of project listing, and that only projects linked to the repository are offered. `apps/api/test/vercel-connect.integration.test.ts` runs the start route and the callback against a real database with Vercel injected: the state round trip, the stored and encrypted token, the proved project chosen over the first listed, the team taken from the grant, and nothing stored on a forged state, a state for another tenant's site, a declined approval, a refused code, no project, or an unproved one.

What it does not cover: a live consent round trip. That needs a registered integration and is the operator's first click.
