import { ExternalLink } from 'lucide-react'
import type { ReactNode } from 'react'

/**
 * A link to somebody else's page.
 *
 * One component, because every one of these needs the same four things and each call site used
 * to remember a different three: it opens in a new tab so the reader keeps their place, it says
 * so to a screen reader, it carries a mark sighted readers recognise, and it tells the other
 * site nothing.
 *
 * `noopener` stops the opened page reaching back into this tab. `noreferrer` stops it learning
 * which page, and so which account, the visit came from. `nofollow` because these are pages we
 * are showing as evidence, not pages we vouch for, which is the distinction we ask other sites
 * to draw with their own links.
 */
export function OutboundLink({
  href,
  children,
  className = '',
}: {
  href: string
  children: ReactNode
  className?: string
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className={`inline-flex max-w-full items-baseline gap-1.5 ${className}`.trim()}
    >
      <span className="min-w-0 break-words">{children}</span>
      <ExternalLink size={12} aria-hidden="true" className="shrink-0 self-center" />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  )
}

/** The path of an address, for a line under a title when the site is already named beside it. */
export function pathOf(url: string): string {
  try {
    const parsed = new URL(url)
    const path = `${parsed.pathname}${parsed.search}`
    return path === '/' ? 'Home page' : decodeURI(path)
  } catch {
    return url
  }
}
