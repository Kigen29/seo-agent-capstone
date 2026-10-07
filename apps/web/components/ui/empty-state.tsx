import type { ReactNode } from 'react'

/**
 * What a list says when it is empty.
 *
 * Generalised from the findings inbox, which had the only well-designed empty state in the app: a
 * centred card, a large figure, and, crucially, *different copy* depending on whether the tenant
 * had nothing at all or merely nothing matching the current filter. Everywhere else settled for a
 * bare sentence in a muted paragraph, and the sites list had no call to action at all.
 *
 * The distinction the inbox got right is the whole point of the component. "You have no findings"
 * and "no findings match this filter" call for different actions, and a list that cannot tell you
 * which situation you are in leaves you clicking Refresh.
 */
export function EmptyState({
  figure,
  title,
  children,
  action,
}: {
  /** A short glyph or number. Kept large and quiet rather than an illustration. */
  figure?: ReactNode
  title: string
  children?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="card mt-8 items-center px-6 py-12 text-center">
      {figure !== undefined && (
        <div
          className="mb-3 flex size-10 items-center justify-center rounded-full"
          style={{
            fontSize: 17,
            fontWeight: 600,
            fontVariantNumeric: 'lining-nums',
            color: 'var(--color-accent-700)',
            background: 'var(--color-accent-100)',
          }}
        >
          {figure}
        </div>
      )}
      <h4 className="mb-2">{title}</h4>
      {children && <p className="text-muted m-0 text-sm">{children}</p>}
      {action && <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  )
}
