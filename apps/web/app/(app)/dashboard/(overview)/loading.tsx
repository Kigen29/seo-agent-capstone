import { SkeletonCards, SkeletonHeader } from '@/components/skeleton'

/**
 * Shown while the sites list loads.
 *
 * There was no `loading.tsx` anywhere in the app, and every data page awaits its data before
 * rendering anything, so a cold API meant a blank tab for up to a minute. Next renders this
 * instantly from the server while the real page resolves.
 *
 * It lives inside the `(overview)` route group rather than directly under `dashboard/` for a
 * reason that cost an e2e failure to find: a `loading.tsx` covers its segment *and every child
 * segment*, so at `dashboard/` it wrapped `audits/[id]` and `findings/[id]` too. That turns those
 * routes into streamed responses, and a streamed response has already sent HTTP 200 by the time
 * `notFound()` runs, so another tenant's audit started answering 200 instead of 404. The route
 * group scopes the boundary to this page alone and changes no URL.
 */
export default function DashboardLoading() {
  return (
    <main id="main" className="wrap">
      <SkeletonHeader />
      <SkeletonCards count={2} />
    </main>
  )
}
