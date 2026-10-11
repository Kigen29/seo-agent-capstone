# ADR-0050: An agent is given the account and the repository separately

- Status: Accepted; extends ADR-0020
- Date: 2026-10-11

## Context

ADR-0020 put one switch on everything the MCP server could change, `SEO_MCP_ALLOW_WRITES`. Behind it were four tools: start an audit, set the audit schedule, open a fix as a pull request, verify a Search Console property by pull request.

The API meanwhile had a dozen more things a person does in the dashboard and an agent could not: track a question, add a competitor, name one, mark a site as not theirs, edit the site's details, add a site, connect a repository. An agent asked to "set this site up" could read everything and do almost none of it.

Adding those behind the same switch would have made one permission out of two very different things. Tidying a list of competitors is reversible and stays inside this product. Opening pull requests reaches somebody's code and lands in a reviewer's queue. A person who wants the first should not have to grant the second.

One thing had no way to be done by anybody. "Won't fix" has been a finding status since the first schema, and an audit has always carried it forward to the same finding on the next one (ADR-0029). Nothing could set it.

## Decision

**1. Two switches.**

| Switch | Lets the agent |
|---|---|
| `SEO_MCP_ALLOW_ACCOUNT_WRITES=1` | Change settings in the account |
| `SEO_MCP_ALLOW_REPO_WRITES=1` | Open pull requests on the connected repository |

`SEO_MCP_ALLOW_WRITES=1` still means both, so no existing setup loses a tool. Only the exact value `1` turns a switch on.

**2. The account tools.** Ten, in `tools/account.ts`: `run_audit`, `set_audit_schedule`, `add_tracked_questions`, `change_competitors`, `name_competitor`, `mark_not_us`, `update_site_details`, `add_site`, `connect_repository`, `set_finding_status`.

**3. The repository tools.** Two, in `tools/write.ts`: `fix_finding` and `verify_site`. The cap on pull requests per session is unchanged.

**4. A finding can be dismissed and reopened.** `PUT /findings/:id/status` moves a finding between `open` and `wontfix` and nowhere else. The dashboard has the same control on a finding's page.

**5. The dashboard offers two checkboxes** under "Connect your editor", both off, each rewriting the config shown.

## Rules the account tools keep

They are held by an agent, and an agent makes mistakes a form does not.

- **Add and remove, never replace.** The API replaces a list whole, which suits a form that shows the list. An agent told to add one competitor would send a list of one and delete the other nine. Each tool reads what is there, changes what was asked, and writes the result. Tracked questions are only ever added, because removing one throws away its history of checks.
- **Say what is now true.** Each tool answers with the state after the change.
- **Bounded.** Ten questions in a call, since each is a paid check every day. Ten competitors in all, the API's own limit.
- **A status an agent may set is one a person may set.** `set_finding_status` takes `open` and `wontfix`. It cannot mark a fix as having worked: that is decided by the live site (ADR-0047).

## What is deliberately not a tool

- **Drafting outreach.** A person sends every email (rule 6). An agent holding a draft is one tool call from sending it with something else, so the draft stays where a person reads it first.
- **Suggesting competitors or questions, and finding publications.** These spend from the allowance. They are next, behind the same "billed" marking the keyword tools carry, and are not in this change.
- **Tokens, sessions, billing, hosting and Google connections.** A token must not make or revoke credentials (ADR-0046), and the others need a person at a consent screen.
- **Fixing several findings in one call.** It would have to share the per-session cap to mean anything, and at three a session it adds little.

## Consequences

- **`connect_repository` grants nothing new.** It records which repository, already granted to the GitHub App by the person in their browser, belongs to which site. It still decides where pull requests go, which is why it reads as an account setting and is described carefully.
- **`run_audit` moved to the account switch.** It changes nothing on the site and opens nothing. It was behind the only switch there was.
- **Dismissal can hide a real problem.** That is what it is for. The finding and its evidence are kept, the page says it was dismissed, and it can be reopened. The tool's description tells the agent this is the person's decision and not a way to shorten a list.
- **A finding with work in flight cannot be dismissed.** Open or merged pull requests, and verified or rejected fixes, are refused with the reason.
- **Both switches together are written as the old one** in the dashboard's config, because that is the one every published version of the server reads. A single permission needs version 0.3.0 or later of the package; on an older one it is silently read-only.
