import { SkeletonCards, SkeletonHeader, SkeletonTable } from '@/components/skeleton'

/**
 * Shown while the visibility report loads.
 *
 * It reads a poll window out of Postgres and summarises it, which is fast but not instant, and a
 * blank page during it reads as "this site has no AI visibility" rather than as "loading". On an
 * axis whose entire posture is about not confusing an absence for a zero, that is the wrong first
 * impression to give.
 */
export default function VisibilityLoading() {
  return (
    <main id="main" className="wrap">
      <SkeletonHeader />
      <SkeletonCards count={4} />
      <SkeletonTable rows={5} columns={4} />
    </main>
  )
}
