# Verification with any hosting pipeline

Rankwright can audit reachable sites and open supported fixes regardless of the hosting company. Automatic verification additionally needs evidence that the merged commit reached the connected production origin. A repository-authorized deployment pipeline can publish that evidence through GitHub Deployments, without a Vercel account or a new Rankwright secret.

The reporting action is an attestation from your pipeline. It does not deploy the site or independently query the host. Only report success after the host confirms the exact commit is serving the production domain. An HTTP 200, successful build, or accepted asynchronous deployment request alone is insufficient. Rankwright subsequently checks commit ancestry and re-crawls the finding's positive checks.

## Add reports to your existing deployment job

Use `.github/actions/report-deployment` from this repository, pinned to a reviewed full commit SHA. The example below is a template: replace `REVIEWED_COMMIT_SHA` and the deployment script with your actual release process. Run trusted production code only, with your normal environment approvals and branch protection. Do not grant this write token to untrusted pull-request code.

```yaml
name: Deploy production
on:
  push:
    branches: [main]
permissions:
  contents: read
  deployments: write
concurrency:
  group: production-example-com
  cancel-in-progress: false
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09 # v5
      # Run your normal tests/build here, or depend on a successful build job.
      - name: Record deployment start
        id: deployment
        uses: Kigen29/seo-agent-capstone/.github/actions/report-deployment@REVIEWED_COMMIT_SHA
        with:
          phase: start
          site-origin: https://example.com
          sha: ${{ github.sha }}
          token: ${{ github.token }}
      - name: Deploy and wait for production confirmation
        id: publish
        run: ./scripts/deploy-and-confirm.sh
        # This must deploy github.sha and wait for authoritative host confirmation.
      - name: Record deployment result
        if: ${{ always() && steps.deployment.outcome == 'success' }}
        uses: Kigen29/seo-agent-capstone/.github/actions/report-deployment@REVIEWED_COMMIT_SHA
        with:
          phase: ${{ steps.publish.outcome == 'success' && 'success' || 'failure' }}
          site-origin: https://example.com
          sha: ${{ github.sha }}
          deployment-id: ${{ steps.deployment.outputs.deployment-id }}
          token: ${{ github.token }}
```

Use the exact origin registered in Rankwright, including apex versus www and any non-default port. A redirect to a different origin is not evidence for the registered origin. Serialize all production changes to the same origin, including changes outside this workflow. Every deployment, retry, and rollback must create a new start report before changing production. Do not reuse an old successful record for a rollback. If the workflow is killed before reporting completion, the in-progress record intentionally blocks verification until a fresh deployment is confirmed.

The start report preserves GitHub's default commit-status checks and disables automatic branch merging. A denied start stops the deployment job. The completion step validates repository, exact SHA, production flag, origin, and an in-progress state. It cannot turn an already completed report into another success. The verifier refuses to fall back to older success when the newest report for the origin is pending, failed, inactive, or contains a rollback commit.

## Other CI systems

Copy `packages/vcs/src/report-deployment.ts` from a reviewed revision and run it with Node 24. It has no package dependencies. Supply these environment variables through your CI's secret and configuration controls:

| Variable | Value |
| --- | --- |
| `GH_TOKEN` | Repository-scoped token with Deployments write access |
| `GITHUB_REPOSITORY` | Connected `owner/repository` |
| `SITE_ORIGIN` | Exact connected HTTPS origin |
| `DEPLOYED_SHA` | Full 40-character SHA actually being deployed |
| `DEPLOYMENT_PHASE` | `start`, then `success` or `failure` |
| `DEPLOYMENT_ID` | Numeric ID returned by `start`, required for completion |

Run `node report-deployment.ts`; the successful start prints `Deployment report: <id>`. In GitHub Actions it also writes the `deployment-id` output. Store that ID for the completion call. API errors stop reporting and do not print credentials or provider response bodies. GitHub Enterprise Server is not supported by this reporter; it uses only `api.github.com`.

## Scope and acceptance

No hosting provider credential is needed by Rankwright for this path. Existing optional hosting integrations still take precedence when they recognize the site; an ambiguous provider response cannot be bypassed by a pipeline report. This protects against a report that disagrees with the provider's current alias assignment.

The trust boundary is repository deployment write access and the operator's deployment confirmation script. These reports are not independent proof of domain ownership, and out-of-band deployments that publish no report cannot be detected through GitHub records alone. A provider lookup offers stronger current-assignment evidence when available. This integration does not make arbitrary existing hosting pipelines work without setup.

Regression tests cover the report lifecycle, mismatched origins and SHAs, completed-report replay, pending/failed reports, and rollback ancestry. Live acceptance on a non-Vercel host still requires an actual deployment pipeline and provider confirmation. Do not create a success record merely to make a finding verified.

API contract: [GitHub deployments](https://docs.github.com/en/rest/deployments/deployments#create-a-deployment) and [deployment statuses](https://docs.github.com/en/rest/deployments/statuses#create-a-deployment-status).
