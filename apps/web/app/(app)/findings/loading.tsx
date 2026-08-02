import { SkeletonHeader, SkeletonTable } from '@/components/skeleton'

/** Shown while the findings inbox loads. See `dashboard/loading.tsx` for why these exist. */
export default function FindingsLoading() {
  return (
    <main id="main" className="wrap">
      <SkeletonHeader />
      <SkeletonTable rows={8} columns={5} />
    </main>
  )
}
