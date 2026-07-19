import type { Finding, Framework } from '@seo/core'
import type { FixContext, Fixer, FixResult } from '../engine.js'
import { headStrategyFor, type ReadRepoFile } from '../framework/detect.js'
import { HEAD_FILES, injectHeadHtml } from '../head/inject.js'

/**
 * LOCAL-001: the homepage has contact details but no LocalBusiness structured data.
 *
 * The fix adds a LocalBusiness JSON-LD block to the head, built from the contact data the rule
 * already found and carried in the finding (the site's own name, address, and telephone). It is
 * deterministic: nothing is invented, the block is assembled from observed values and inserted with
 * the same head injector that places the Search Console tag. The address the site already had is
 * simply re-typed as a LocalBusiness so Google can use it for local features.
 */
export class LocalBusinessFixer implements Fixer {
  readonly ruleId = 'LOCAL-001'

  canFix(finding: Finding): boolean {
    return (
      finding.ruleId === 'LOCAL-001' &&
      finding.evidence.kind === 'markup' &&
      contactFrom(finding) !== null
    )
  }

  async generate(ctx: FixContext): Promise<FixResult | null> {
    const contact = contactFrom(ctx.finding)
    if (contact === null) return null

    const url = ctx.finding.affectedUrls[0]
    const name = contact.name ?? (await currentTitle(ctx.framework, ctx.read)) ?? hostOf(url)

    const block: Record<string, unknown> = {
      '@context': 'https://schema.org',
      '@type': 'LocalBusiness',
      name,
    }
    if (url) block['url'] = url
    if (contact.telephone) block['telephone'] = contact.telephone
    if (contact.address !== undefined) block['address'] = contact.address

    const script = `<script type="application/ld+json">\n${JSON.stringify(block, null, 2)}\n</script>`
    const change = await injectHeadHtml(ctx.framework, ctx.read, [script])
    if (!change) return null

    return {
      files: [change],
      expectedEffect:
        `Adds a LocalBusiness JSON-LD block naming "${name}", built from the contact details the ` +
        "site already publishes. Google's Rich Results Test should then recognise a LocalBusiness, " +
        'which makes the site eligible for local result features. Only meaningful for a business ' +
        'with a physical presence.',
      rollback:
        'Revert the merge commit; the LocalBusiness block is removed and nothing else changes.',
    }
  }
}

interface Contact {
  name?: string
  address?: unknown
  telephone?: string
}

/** The contact data the rule carried in the finding's evidence, or null if it cannot be read. */
function contactFrom(finding: Finding): Contact | null {
  if (finding.evidence.kind !== 'markup') return null
  try {
    const parsed = JSON.parse(finding.evidence.snippet) as Contact
    if (!parsed || typeof parsed !== 'object') return null
    // Something to build a block from: at least an address or a phone.
    if (parsed.address === undefined && parsed.telephone === undefined) return null
    return parsed
  } catch {
    return null
  }
}

/** The homepage title, read from the framework's head file, when the finding carried no name. */
async function currentTitle(framework: Framework, read: ReadRepoFile): Promise<string | null> {
  for (const path of HEAD_FILES[headStrategyFor(framework)]) {
    const content = await read(path)
    if (content === null) continue
    const match = content.match(/<title>([^<]*)<\/title>/i)
    if (match && match[1]!.trim()) return match[1]!.trim()
  }
  return null
}

function hostOf(url: string | undefined): string {
  if (!url) return 'This business'
  try {
    return new URL(url).host
  } catch {
    return url
  }
}
