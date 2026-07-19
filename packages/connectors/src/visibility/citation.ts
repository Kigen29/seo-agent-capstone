import type { CitationCheck, EngineAnswer, PollTarget } from './types.js'

/**
 * Decide, deterministically, whether an engine answer cites a domain.
 *
 * This is the parser that keeps the axis honest (ADR-0001): given the answer and its cited sources,
 * a pure function returns the verdict. Nothing here asks a model for its opinion.
 */

/** The registrable-ish host of a URL or a bare host, lowercased and without a leading `www.`. */
export function hostOf(urlOrHost: string): string | null {
  const trimmed = urlOrHost.trim()
  if (!trimmed) return null
  try {
    const url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`)
    return url.hostname.replace(/^www\./i, '').toLowerCase()
  } catch {
    return null
  }
}

/**
 * Whether two hosts are the same site. Exact match after normalisation, or one is a subdomain of
 * the other (blog.example.com and example.com are the same site for citation purposes).
 */
export function sameSite(a: string, b: string): boolean {
  const ha = hostOf(a)
  const hb = hostOf(b)
  if (!ha || !hb) return false
  return ha === hb || ha.endsWith(`.${hb}`) || hb.endsWith(`.${ha}`)
}

/** Whether the answer text names the domain, used only when the engine returns no source list. */
function answerMentions(answer: string, domain: string): boolean {
  const host = hostOf(domain)
  if (!host) return false
  const haystack = answer.toLowerCase()
  // The full host if it appears, else the registrable stem as a whole word. The stem match is
  // deliberately conservative: a two-plus character stem bounded by non-word characters, so
  // "acme" matches "Acme Safaris" but not "acmeric".
  if (haystack.includes(host)) return true
  const stem = host.split('.')[0]
  if (!stem || stem.length < 2) return false
  return new RegExp(`(^|[^a-z0-9])${escapeRegExp(stem)}([^a-z0-9]|$)`, 'i').test(answer)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * The citation verdict for one engine answer. Prefers the engine's own source list; falls back to a
 * text mention only when the engine gave no sources, and records which basis was used so a caller
 * can weight a mention-based result lower than a cited one.
 */
export function checkCitation(answer: EngineAnswer, target: PollTarget): CitationCheck {
  const citedHosts = answer.citations.map(hostOf).filter((h): h is string => h !== null)
  const hasSources = citedHosts.length > 0

  const isCited = (domain: string): boolean =>
    hasSources
      ? citedHosts.some((host) => sameSite(host, domain))
      : answerMentions(answer.answer, domain)

  return {
    engine: answer.engine,
    prompt: answer.prompt,
    cited: isCited(target.domain),
    citedCompetitors: target.competitors.filter(isCited),
    basis: hasSources ? 'citations' : 'mention',
  }
}
