import type { TopicMap } from '@seo/api-client'

/**
 * What the site is about, drawn as proportions.
 *
 * A treemap in the sense that matters: area is share, so the thing the site is mostly about is
 * the thing that takes up most of the space. Built from stacked flex rows rather than a charting
 * library, because the whole figure is "rectangles whose widths are percentages" and a dependency
 * that renders it would also have to be themed, made keyboard-reachable and kept in step with a
 * design system it knows nothing about.
 *
 * Two things are stated rather than implied, both because a topic map is easy to over-read:
 * the shares are of the pages actually embedded, not of the site, and the grouping is what was
 * measured while the names are a model's label for each group (ADR-0024).
 */

/**
 * A fixed palette rather than a hue per index.
 *
 * Generated hues drift into unreadable contrast at the extremes and change meaning between runs
 * when a cluster count changes. Six tokens, cycled, keeps every block legible in both themes.
 */
const TONES = [
  'var(--color-accent-700)',
  'var(--color-accent-500)',
  'var(--color-neutral-700)',
  'var(--color-neutral-500)',
  'var(--color-accent-300)',
  'var(--color-neutral-300)',
]

const percent = (share: number) => `${Math.round(share * 100)}%`

export function TopicMapFigure({ map }: { map: TopicMap }) {
  // Blocks below this are unreadable as text, so they keep their colour and drop their label
  // rather than overflowing it into the neighbouring block.
  const LABEL_FLOOR = 0.08

  // The index is kept so a group's swatch matches its block in the bar above.
  const indexed = map.clusters.map((cluster, index) => ({ cluster, index }))
  const groups = indexed.filter(({ cluster }) => cluster.pages.length > 1)
  const alone = indexed.filter(({ cluster }) => cluster.pages.length === 1)

  return (
    <div>
      <div
        className="flex w-full overflow-hidden"
        style={{
          height: 'var(--space-8)',
          borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--color-divider)',
        }}
        role="img"
        aria-label={map.clusters
          .map((cluster) => `${cluster.name}, ${percent(cluster.share)}`)
          .join('; ')}
      >
        {map.clusters.map((cluster, index) => (
          <div
            key={cluster.name + String(index)}
            title={`${cluster.name}: ${cluster.pages.length} page(s), ${percent(cluster.share)}`}
            style={{
              width: percent(cluster.share),
              background: TONES[index % TONES.length],
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--color-surface)',
              fontSize: 12,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
            }}
          >
            {cluster.share >= LABEL_FLOOR ? percent(cluster.share) : ''}
          </div>
        ))}
      </div>

      <ul className="mt-4 grid gap-2" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {groups.map(({ cluster, index }) => (
          <li key={cluster.name + String(index)} className="flex items-baseline gap-3">
            <span
              aria-hidden
              className="shrink-0"
              style={{
                width: 10,
                height: 10,
                borderRadius: 2,
                background: TONES[index % TONES.length],
              }}
            />
            <span className="min-w-0 flex-1 truncate text-sm">{cluster.name}</span>
            <span className="tnum shrink-0 text-[13px]" style={{ opacity: 0.7 }}>
              {cluster.pages.length} page{cluster.pages.length === 1 ? '' : 's'} ·{' '}
              {percent(cluster.share)}
            </span>
          </li>
        ))}
      </ul>

      {/*
        A page that resembles no other is a topic of one. A site about a single subject has many
        of them, and twenty rows each saying "1 page, 2%" bury the groups above. So they are
        counted on one line and listed on request.
      */}
      {alone.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm">
            {alone.length} page{alone.length === 1 ? '' : 's'} that stand
            {alone.length === 1 ? 's' : ''} alone ·{' '}
            {percent(alone.reduce((sum, { cluster }) => sum + cluster.share, 0))}
          </summary>
          <p className="text-muted mt-2 mb-0 max-w-[72ch] text-[13px]" style={{ lineHeight: 1.7 }}>
            {alone.map(({ cluster }) => cluster.name).join(' · ')}
          </p>
        </details>
      )}

      <p className="text-muted mt-4 mb-0 text-[13px]">
        Shares are of the {map.pagesEmbedded} page{map.pagesEmbedded === 1 ? '' : 's'} measured, out
        of {map.pagesCrawled} crawled. Pages were grouped by similarity, which is the measurement;
        the names are a label applied to each group afterwards and nothing here depends on them.
        {map.model ? ` Measured with ${map.model}.` : ''}
      </p>
    </div>
  )
}
