import Link from 'next/link'

/**
 * Where this page sits, and every way back up from it.
 *
 * The finding detail page had a single link reading "Back to the audit", which was a dead end for
 * most of the people who reached it: the inbox at `/findings` is the main route into a finding, and
 * from there the audit is a page the user has never seen. "Back" that goes somewhere you have not
 * been is worse than no back link, because it looks like it should return you and does not.
 *
 * A trail rather than a single link, so every ancestor is reachable and the page says where it is
 * rather than only where it might have come from. `aria-current="page"` marks the last crumb, and
 * the separators are decorative so a screen reader reads a list of links and not a row of slashes.
 */
export function Breadcrumbs({
  trail,
}: {
  /** Ancestors first, this page last. The last entry renders as text, not a link. */
  trail: { label: string; href?: string }[]
}) {
  return (
    <nav aria-label="Breadcrumb" className="mb-4">
      <ol className="text-muted m-0 flex flex-wrap items-center gap-1 p-0 text-[13px]">
        {trail.map((crumb, i) => {
          const last = i === trail.length - 1
          return (
            <li key={`${crumb.label}-${i}`} className="flex items-center gap-1">
              {i > 0 && (
                <span aria-hidden="true" className="text-subtle">
                  /
                </span>
              )}
              {crumb.href && !last ? (
                <Link href={crumb.href}>{crumb.label}</Link>
              ) : (
                <span aria-current={last ? 'page' : undefined}>{crumb.label}</span>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
