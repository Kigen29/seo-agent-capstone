import { SkeletonHeader, SkeletonTable } from '@/components/skeleton'

/**
 * Shown while a keyword search runs.
 *
 * This one is a real wait rather than a token one: the request goes out to a paid vendor and back.
 * Without it the page looks unchanged after pressing Search, which invites a second press, and a
 * second press is a second billed query.
 */
export default function KeywordsLoading() {
  return (
    <main id="main" className="wrap">
      <SkeletonHeader />
      <SkeletonTable rows={8} columns={4} />
    </main>
  )
}
