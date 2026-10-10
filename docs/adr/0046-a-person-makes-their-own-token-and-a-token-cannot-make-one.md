# ADR-0046: A person makes their own token, and a token cannot make one

- Status: Accepted; builds on ADR-0020 and ADR-0023
- Date: 2026-10-10

## Context

ADR-0020 made the product an MCP server, a second door for agents. For everybody but the operator the door was locked. Connecting needs an API token, and the only way to make one was `mint-token`, a command that needs the production database. The dashboard listed tokens and revoked them and could not create one.

The server itself was also not installable. It is a workspace package that imports two others which exist only in this repository, so the instructions were "clone the repository and build all of it".

The result: the README said any MCP client could drive the product, and one person could.

## Decision

**1. A signed-in person creates a token in the dashboard.** `POST /auth/tokens` with a name and a lifetime returns the token once. Only its hash is stored, as for every other credential, so it cannot be shown a second time.

**2. Only a browser session may create a token. A token cannot.** The route reads the kind of the credential on the request and refuses anything that is not a session, with 403.

**3. Every token made this way expires**, after 30, 90 or 365 days. There is no "never".

**4. An account holds at most ten live tokens.** Sessions do not count.

**5. The page hands over a config that already contains the token.** Under the token, while it is on screen, are the command for Claude Code and the JSON other editors read, filled in. Neither turns writes on.

**6. The server can be published as one file.** `pnpm --filter @seo/mcp bundle` writes `apps/mcp/publish/`: a single `server.js` with its workspace dependencies inlined, a `package.json` with a `bin`, and a README, ready for `npm publish`. The dashboard shows an `npx` config when `NEXT_PUBLIC_MCP_PACKAGE` names a published package and a clone-and-build config when it does not.

## Why each limit

- **A token cannot make a token** because of what happens after a leak. Whoever holds a leaked token has the account until somebody revokes it. If they could mint a second credential first, revoking the one that leaked would end nothing. Sessions come from signing in with GitHub or Google, which a thief with only an API token cannot do.
- **Expiry** because the credential that causes harm is the one nobody remembers making. `mint-token` still makes tokens that never expire, and it should: it is an operator's tool, run by somebody with the database. The dashboard is everybody else.
- **Ten** because a person has a few machines, and because the moment the limit is reached is the moment they look at the list and find the three they forgot.
- **The config does not turn writes on** because the person pasting it has usually only decided to look. Opening pull requests is a second decision, and the page says how to make it.
- **The `npx` config is shown only when the package exists** because the alternative is a first experience that ends in an npm 404.

## Consequences

- **A token pasted at sign-in cannot create tokens.** The sign-in page still accepts a pasted token, behind a disclosure, and somebody signed in that way gets the 403 with a sentence saying to sign in properly. That is the intended behaviour and it is tested.
- **The token is in the browser's memory until the page is left.** It is returned by a server action, held in component state, and not written to the address, a cookie or storage. A reload loses it, which is the design.
- **Still local, still stdio.** The server runs on the person's machine. A hosted endpoint, where a user pastes a URL and signs in with nothing installed, needs a second web service or the MCP transport inside the API, plus OAuth. The free tier has room for one service (ADR-0006). This decision does not change that; it makes the local route usable by people who are not the operator.
- **Publishing is a manual step with somebody's npm account.** Until it is done, the dashboard shows the clone route, which is true.
- **The package claims no licence.** The repository has no licence file, so the generated `package.json` says `UNLICENSED`. Choosing one is a decision for the author, and publishing before making it means nobody else may legally reuse the code.
- **Rate limited as a costly route**: twelve a minute per account, with the other things that should not be looped.
