import type { Finding } from '@seo/core'
import { detectFramework, injectHeadHtml } from '@seo/fixers'
import type { ReadRepoFile } from '@seo/fixers'
import type { RepoContext, VersionControlProvider } from '@seo/vcs'

/**
 * The Search Console auto-verification vertical: the demo no dashboard competitor can do.
 *
 * It is the whole product thesis in one function. Google needs to confirm the tenant owns the
 * site before it will show them Search Console data; normally a human copies a meta tag into
 * their site by hand. Here the agent does it: it creates the property, fetches the exact token,
 * detects the framework, drops the tag into the right file, and opens a pull request. The human
 * merges, and `confirmVerification` asks Google to check. We have the repo, so we can close the
 * loop; nobody who only has a dashboard can.
 *
 * The collaborators are injected as the smallest interfaces this needs, so the composition is
 * testable with fakes and knows nothing about OAuth, HTTP, or Octokit. The worker resolves the
 * tenant's token into real clients and passes them in.
 */

/** Just the Search Console call this needs: create the property. */
export interface PropertyClient {
  addSite(siteUrl: string): Promise<void>
}

/** Just the Site Verification calls this needs: fetch the token, and confirm ownership. */
export interface VerificationClient {
  getMetaToken(siteUrl: string): Promise<string>
  verifyMeta(siteUrl: string): Promise<boolean>
}

export interface OpenVerificationPrInput {
  siteId: string
  /** The site's URL. Normalised to the URL-prefix property form (origin + '/') internally. */
  siteUrl: string
  /** The connected repo and its installation, so the provider can open a PR. */
  repo: RepoContext
}

export interface VerificationCollaborators {
  property: PropertyClient
  verification: VerificationClient
  provider: VersionControlProvider
}

export interface VerificationPrResult {
  prUrl: string
  branch: string
  /** The URL-prefix property the tag verifies, e.g. `https://example.com/`. */
  property: string
  framework: string
  token: string
}

/** Thrown when the tag cannot be placed: no `<head>` was found in the repo, or it is already there. */
export class VerificationInjectionError extends Error {
  constructor() {
    super(
      'Could not add the verification meta tag: no <head> was found in a recognised file, or ' +
        'the tag is already present. A human may need to add it, or the site may already be verifiable.',
    )
    this.name = 'VerificationInjectionError'
  }
}

/** The URL-prefix property form Site Verification's META method expects: origin with a slash. */
export function toUrlPrefixProperty(siteUrl: string): string {
  return `${new URL(siteUrl).origin}/`
}

/**
 * The synthetic finding behind the verification PR.
 *
 * Verification is not raised by a crawl rule, but a PR still has to carry the five sections
 * (rule 4), and the cleanest way to satisfy that is to describe verification as what it is: a
 * fixable finding with real evidence (the missing tag) and a real falsification (Google still
 * reports it unverified after merge).
 */
function verificationFinding(siteId: string, property: string): Finding {
  return {
    id: `AGENT-VERIFY-${siteId}`,
    siteId,
    ruleId: 'AGENT-VERIFY',
    axis: 'crawl_health',
    severity: 'high',
    confidence: 1,
    title: `Verify ${property} in Google Search Console`,
    evidence: {
      kind: 'markup',
      url: property,
      locator: 'head > meta[name="google-site-verification"]',
      snippet: '',
      observedAt: new Date().toISOString(),
      source: 'repo',
    },
    affectedUrls: [property],
    estimatedEffort: 'trivial',
    estimatedImpact: 80,
    falsification:
      'After this PR is merged and deployed, Site Verification (webResource.insert) still ' +
      'reports the property as not verified.',
    fixable: true,
    status: 'open',
  }
}

/**
 * Create the property, fetch the token, inject the tag, and open the PR. Returns what the caller
 * needs to store on the site (property, prUrl) and to verify later (property).
 */
export async function openVerificationPr(
  input: OpenVerificationPrInput,
  deps: VerificationCollaborators,
): Promise<VerificationPrResult> {
  const property = toUrlPrefixProperty(input.siteUrl)

  // Create the Search Console property. It exists but stays unverified until the tag is live.
  await deps.property.addSite(property)

  // Fetch the real token. Never invented: this is the exact value Google will look for.
  const token = await deps.verification.getMetaToken(property)

  const read: ReadRepoFile = async (path) =>
    (await deps.provider.getFile(input.repo, path))?.content ?? null

  const framework = await detectFramework(read)

  // The token from getMetaToken is already the complete `<meta name="google-site-verification">`
  // tag, so it is inserted verbatim. Wrapping it in another tag, or escaping it, is exactly the
  // bug that stopped Google recognising it: insert what Google gave us, unchanged.
  const change = await injectHeadHtml(framework, read, [token])
  if (!change) throw new VerificationInjectionError()

  const pr = await deps.provider.openPullRequest(input.repo, {
    finding: verificationFinding(input.siteId, property),
    files: [change],
    expectedEffect:
      `Google can confirm you own ${property}, which unlocks Search Console data for this ` +
      'site and completes verification automatically once merged.',
    rollback:
      'Revert the merge commit; the verification meta tag is removed and nothing else changes.',
  })

  return { prUrl: pr.url, branch: pr.branch, property, framework, token }
}

/**
 * Ask Google to confirm ownership, after the PR is merged and the tag is live. True only on
 * Google's success; false is the ordinary "not yet" while a deploy propagates, not an error.
 */
export async function confirmVerification(
  property: string,
  verification: VerificationClient,
): Promise<boolean> {
  return verification.verifyMeta(property)
}
