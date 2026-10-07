import { SkeletonHeader, SkeletonTable } from '@/components/skeleton'

/** Shown while the competitor watch loads. See `visibility/loading.tsx` for why these exist. */
export default function CompetitorsLoading() {
  return (
    <main id="main" className="wrap">
      <SkeletonHeader />
      <SkeletonTable rows={4} columns={2} />
    </main>
  )
}
