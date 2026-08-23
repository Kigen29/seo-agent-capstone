import { SkeletonCards, SkeletonHeader } from '@/components/skeleton'

/** Shown while the authority figures load. See `visibility/loading.tsx` for why these exist. */
export default function AuthorityLoading() {
  return (
    <main id="main" className="wrap">
      <SkeletonHeader />
      <SkeletonCards count={4} />
    </main>
  )
}
