import { SkeletonCards, SkeletonHeader } from '@/components/skeleton'

/** Shown while the topic map loads. See `visibility/loading.tsx` for why these exist. */
export default function TopicsLoading() {
  return (
    <main id="main" className="wrap">
      <SkeletonHeader />
      <SkeletonCards count={4} />
    </main>
  )
}
