import type { Finding } from '@seo/core'
import type { FixContext, Fixer, FixResult } from '../engine.js'
import { addJsonLdProperties } from '../head/json-ld.js'

/**
 * LOCAL-002: the LocalBusiness markup does not link to the connected Google Business Profile.
 *
 * The fix adds `hasMap` and `sameAs`, both pointing at the profile link the finding carries, to
 * the LocalBusiness node that already exists. Nothing is invented: the URL was decoded from the
 * share link the client pasted, and the node was found by parsing the file rather than by guessing
 * where markup lives.
 *
 * It edits the existing block rather than adding one, because a second LocalBusiness node would
 * describe a second business. When the block is not in a file we can name (a plugin, a CMS, a
 * component we cannot guess), it produces nothing and the failure is recorded on the finding,
 * which is the honest outcome ADR-0022 asks for.
 */
export class LocalProfileLinksFixer implements Fixer {
  readonly ruleId = 'LOCAL-002'

  canFix(finding: Finding): boolean {
    return finding.ruleId === 'LOCAL-002' && detailsFrom(finding) !== null
  }

  async generate(ctx: FixContext): Promise<FixResult | null> {
    const details = detailsFrom(ctx.finding)
    if (details === null) return null

    const change = await addJsonLdProperties(
      ctx.framework,
      ctx.read,
      isLocalBusiness,
      // `sameAs` is an array because schema.org treats it as a list of identity links, and a site
      // that later adds a Facebook page should be appending rather than reworking the shape.
      { hasMap: details.profileUrl, sameAs: [details.profileUrl] },
    )
    if (!change) return null

    return {
      files: [change],
      expectedEffect:
        `Links the existing LocalBusiness markup to the Google Business Profile at ` +
        `${details.profileUrl} through hasMap and sameAs. That tells Google which profile this ` +
        'site belongs to, so the reviews, hours and map listing are understood as the same ' +
        'business. It is entity linking rather than a ranking factor, and no position change ' +
        'should be expected from it alone.',
      rollback:
        'Revert the merge commit; the two properties are removed and the rest of the block is ' +
        'exactly as it was.',
    }
  }
}

/** What the rule carried: the profile link to write, and which properties were missing. */
interface ProfileLinks {
  profileUrl: string
  missing: string[]
}

function detailsFrom(finding: Finding): ProfileLinks | null {
  if (finding.evidence.kind !== 'markup') return null

  try {
    const parsed = JSON.parse(finding.evidence.snippet) as Partial<ProfileLinks>
    // A profile link that is not a Maps profile link is not something to write into a client's
    // markup, whatever produced the finding.
    if (typeof parsed.profileUrl !== 'string') return null
    if (!/^https:\/\/maps\.google\.com\/\?cid=\d+$/.test(parsed.profileUrl)) return null

    return { profileUrl: parsed.profileUrl, missing: parsed.missing ?? [] }
  } catch {
    return null
  }
}

/**
 * Whether a JSON-LD node is a LocalBusiness or one of its subtypes.
 *
 * A deliberate near-copy of the rule engine's test rather than an import: `@seo/rules` is a
 * development dependency here, for tests, and making it a runtime one would tie the write path to
 * the detection package that ADR-0001 keeps separate. The duplication is six lines and the
 * coupling it avoids is a package boundary.
 */
const LOCAL_SUFFIX = /(Business|Store|Shop|Restaurant|Service|Salon)$/

function isLocalBusiness(node: Record<string, unknown>): boolean {
  const type = node['@type']
  const types = typeof type === 'string' ? [type] : Array.isArray(type) ? type : []

  return types.some(
    (value) => typeof value === 'string' && (value === 'LocalBusiness' || LOCAL_SUFFIX.test(value)),
  )
}
