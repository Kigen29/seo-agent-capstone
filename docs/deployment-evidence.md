# Confirming the deployed fix

A merged pull request is not deployment proof. Verification first confirms which commit serves the connected site, then crawls for the finding's positive checks. Missing evidence leaves the finding merged and inconclusive, with a retry note.

## GitHub deployment records

The installed Rankwright GitHub App needs repository **Deployments: Read** permission, including approval of that permission by existing installation owners. A 403 access failure is distinct from a readable deployment record that does not confirm the origin. See [ADR-0027](adr/0027-read-deployment-evidence.md) and issue #269.

Without a hosting integration, the latest production report for the connected site's exact origin must be successful. Its SHA must equal the PR merge commit or include it as an ancestor. A pending, failed, or inactive report, rollback, divergent history, or unreadable comparison cannot fall back to an older successful deployment.

For other hosts, use the [host-independent deployment reporting action](hosting-independent-deployments.md) in the site's trusted release pipeline. It uses GitHub deployment permissions and requires no Vercel credential. The pipeline must confirm production completion before reporting success; the action does not deploy or probe the host itself.

## Vercel custom domains

Vercel's GitHub status can name an immutable generated deployment URL instead of the custom domain. The live acceptance in issue #262 also observed a record named Production with `production_environment=false`. Inferring the custom-domain assignment from either that name or the hostname would be unsafe.

Configure the worker with:

- `VERCEL_TOKEN`: GitHub Actions secret with access to the site's Vercel project. Never expose it in the web app or paste it into an issue.
- `VERCEL_TEAM_ID`: repository variable for a team-owned project, when needed. Omit for personal resources.

The lookup makes authenticated read requests only to `api.vercel.com`. It resolves the connected hostname's **current alias assignment**, reads that deployment, and requires a ready production deployment with completed alias assignment. Alias and deployment project IDs must agree, and the GitHub source repository ID must match the connected repository. GitHub then checks the source SHA against the PR merge commit.

The current alias is read again before accepting the evidence. A changing assignment stays inconclusive. A rollback yields the currently assigned older SHA, which fails ancestry; the lookup does not search history for a more convenient success.

Provider-confirmed redirects between the apex and www hostname are supported within the same project, with a bounded chain and cycle detection. Cross-domain redirects, microfrontend routing, staged or rolling deployments, nonstandard origins, missing source metadata, and unreadable API responses stay inconclusive. An alias not found in the configured Vercel account can still use the origin-strict GitHub path; provider errors or recognized-but-unconfirmed assignments cannot bypass the hosting check.

References: [Vercel REST API authentication and teams](https://vercel.com/docs/rest-api), [alias endpoint reference](https://github.com/vercel/sdk/blob/main/docs/sdks/aliases/README.md), [deployment response fields](https://github.com/vercel/sdk/blob/main/docs/models/getdeploymentresponsebody.md).

## Acceptance evidence, 4 October 2026

- Migration 0028 was applied before merging #261. Main CI, production API smoke, tenant isolation, authenticated web pages, and the worker were checked.
- #263 fixed the ignored manual queue selector and added the deployed API revision to health. A verification-only run subsequently executed zero visibility polls.
- A fresh connected-site audit completed 50 pages in about 58 seconds. The generated sitemap PR changed 21 entries because the homepage was treated as a URL prefix. It was closed unmerged; #264 repaired exact loc matching and passed 126 fixer tests.
- The regenerated client PR [kenya-safari-architect#26](https://github.com/Kigen29/kenya-safari-architect/pull/26) changed one line, passed its build and browser checks, and was merged under the owner's release authorization. The live sitemap matched the merged file exactly (SHA-256 `42305db6be0a8125dc19e465d64be45082292720adec8a10f92b56c0e41632c5`).
- Normal reconciliation recorded both the first PR's closed attempt and the second PR's merge. Automated verification stayed inconclusive because hosting evidence was missing. No finding status or deployment record was fabricated to make this check pass.

The hosting lookup's mocked regressions are not live Vercel API acceptance. Keep issues #262 and #265 open until configured provider access confirms the real domain and the worker records a fresh verdict. Interactive OAuth consent and time-delayed Search Console measurement remain separate acceptance steps.
