/**
 * Placeholder shapes for content that has not arrived.
 *
 * Every data page in the app is `force-dynamic` and awaits its data before rendering a single
 * byte, and there was no `loading.tsx` and no `<Suspense>` anywhere. On a warm API that is a
 * flicker. On a cold Render instance it is up to a minute of a completely blank browser tab with
 * nothing but the tab spinner, which is indistinguishable from a hung page.
 *
 * These are deliberately dull. A skeleton's job is to hold the shape of what is coming so the
 * layout does not jump when it lands, not to entertain.
 */

export function Skeleton({
  width = '100%',
  height = 16,
}: {
  width?: string | number
  height?: number
}) {
  return (
    <span
      aria-hidden="true"
      className="skeleton"
      style={{ width, height, display: 'block', borderRadius: 'var(--radius-sm)' }}
    />
  )
}

/** A page header: kicker, title, and a line of supporting text. */
export function SkeletonHeader() {
  return (
    <div className="flex flex-col gap-2" style={{ marginBottom: 'var(--space-6)' }}>
      <Skeleton width={90} height={10} />
      <Skeleton width="min(28ch, 100%)" height={34} />
    </div>
  )
}

/**
 * A table of `rows` lines. `aria-busy` and a polite live region mean a screen reader is told the
 * page is loading rather than being read a wall of meaningless boxes.
 */
export function SkeletonTable({ rows = 6, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading</span>
      <div
        className="flex flex-col"
        style={{
          gap: 'var(--space-3)',
          borderTop: '1px solid var(--color-divider)',
          paddingTop: 'var(--space-3)',
        }}
      >
        {Array.from({ length: rows }, (_, row) => (
          <div key={row} className="flex items-center" style={{ gap: 'var(--space-4)' }}>
            {Array.from({ length: columns }, (_, column) => (
              <div key={column} style={{ flex: column === 0 ? 3 : 1 }}>
                <Skeleton height={14} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

/** A grid of cards, for the sites list. */
export function SkeletonCards({ count = 3 }: { count?: number }) {
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className="flex flex-col"
      style={{ gap: 'var(--space-3)' }}
    >
      <span className="sr-only">Loading</span>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="card elev-sm">
          <Skeleton width="min(32ch, 70%)" height={18} />
          <Skeleton width="min(20ch, 40%)" height={12} />
        </div>
      ))}
    </div>
  )
}
