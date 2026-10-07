import { z } from 'zod'

/**
 * Competitors a site might want to compare itself with, drafted for a person to accept or not.
 *
 * A suggestion, never a finding. The model is not deciding who the competitors are; it is saving
 * somebody from a blank box, in the same way the question suggester does. Nothing is tracked until
 * a person ticks it.
 *
 * A model asked for domains will invent some. So what it returns is only a list of candidates:
 * the caller keeps a domain only after it has been fetched and has answered, and shows the title
 * of what answered so the person can see what they are being offered. This module does the parts
 * that need no network: one schema-validated call, then normalising, removing the site itself and
 * anything already tracked, and removing the kinds of site that are never a competitor.
 */

export interface CompetitorSuggestionLlm {
  object<T>(opts: {
    role: 'smart'
    tenantId: string
    schema: z.ZodType<T>
    system?: string
    prompt: string
  }): Promise<{ output: T }>
}

export interface CompetitorContext {
  url: string
  brand?: string | null
  /** What the business offers, in its owner's words. The strongest signal there is. */
  offering?: string | null
  /** The country or region its customers are in. */
  market?: string | null
  title?: string | null
  description?: string | null
  headings?: string[]
  /** Already tracked, so not worth offering again. */
  existing?: string[]
}

export interface CompetitorCandidate {
  domain: string
  reason: string
}

/** Asked for, before checking. More than is shown, because some will not survive the check. */
export const MAX_COMPETITOR_CANDIDATES = 12

const candidateSchema = z.object({
  competitors: z.array(z.object({ domain: z.string(), reason: z.string() })),
})

const MAX_REASON = 160

/**
 * Sites that turn up in every list and compete with nobody: marketplaces, directories, review
 * sites, social platforms. A business is listed on them; it does not lose customers to them.
 */
const NEVER_A_COMPETITOR = new Set([
  'facebook.com',
  'instagram.com',
  'linkedin.com',
  'x.com',
  'twitter.com',
  'youtube.com',
  'tiktok.com',
  'pinterest.com',
  'wikipedia.org',
  'tripadvisor.com',
  'yelp.com',
  'trustpilot.com',
  'google.com',
  'maps.google.com',
  'amazon.com',
  'booking.com',
  'jumia.co.ke',
  'reddit.com',
  'quora.com',
])

const SYSTEM = [
  'You name direct competitors of a business: other businesses that sell the same kind of thing',
  'to the same customers in the same market, and that a customer would realistically choose instead.',
  'Rules:',
  '- Give each as a bare domain, like example.com. No paths, no https.',
  '- Match the market. A business serving one country competes with businesses serving that country.',
  '- Match the size and kind of business. A small local firm does not compete with a global brand.',
  '- Never a marketplace, directory, review site, social network or news site.',
  '- Never the business itself.',
  '- Only domains you are confident exist. Fewer good ones is better than a full list.',
  '- Each reason is one short plain sentence saying what they offer, with no em dashes.',
].join('\n')

function describe(context: CompetitorContext): string {
  const lines = [`Website: ${context.url}`]
  if (context.brand) lines.push(`Business name: ${context.brand}`)
  if (context.offering) lines.push(`What they offer, in their words: ${context.offering}`)
  if (context.market) lines.push(`Market: ${context.market}`)
  if (context.title) lines.push(`Homepage title: ${context.title}`)
  if (context.description) lines.push(`Homepage description: ${context.description}`)
  if (context.headings?.length) lines.push(`Headings: ${context.headings.slice(0, 12).join(' | ')}`)
  if (context.existing?.length)
    lines.push(`Already tracked (do not repeat): ${context.existing.join(', ')}`)
  lines.push(`Name up to ${MAX_COMPETITOR_CANDIDATES} direct competitors.`)
  return lines.join('\n')
}

/** `https://www.Rival.com/tours` gives `rival.com`. Null for anything that is not a hostname. */
export function domainOf(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase()
  if (!trimmed) return null
  try {
    const host = new URL(/^[a-z]+:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`).hostname
    const bare = host.replace(/^www\./, '')
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(bare) ? bare : null
  } catch {
    return null
  }
}

export async function suggestCompetitors(
  llm: CompetitorSuggestionLlm,
  tenantId: string,
  context: CompetitorContext,
): Promise<CompetitorCandidate[]> {
  const { output } = await llm.object({
    role: 'smart',
    tenantId,
    schema: candidateSchema,
    system: SYSTEM,
    prompt: describe(context),
  })

  const own = domainOf(context.url)
  const seen = new Set((context.existing ?? []).map((entry) => domainOf(entry) ?? entry))
  const kept: CompetitorCandidate[] = []

  for (const entry of output.competitors) {
    const domain = domainOf(entry.domain)
    if (!domain || domain === own || seen.has(domain)) continue
    if (NEVER_A_COMPETITOR.has(domain)) continue
    // A subdomain of the site itself, or the site as a subdomain of the candidate.
    if (own && (domain.endsWith(`.${own}`) || own.endsWith(`.${domain}`))) continue

    seen.add(domain)
    kept.push({
      domain,
      reason: entry.reason
        .replace(/\s*—\s*/g, ', ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, MAX_REASON),
    })
    if (kept.length === MAX_COMPETITOR_CANDIDATES) break
  }

  return kept
}
