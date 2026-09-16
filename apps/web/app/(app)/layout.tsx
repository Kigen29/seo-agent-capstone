import type { SignedInIdentity } from '@seo/api-client'
import { redirect } from 'next/navigation'
import { Sidebar, type SidebarSite } from '@/components/sidebar'
import { getClient, getToken } from '@/lib/session'

/**
 * One gate and one shell for every authenticated page.
 *
 * There used to be two of each. `/dashboard` had a layout with an auth check and the top nav;
 * `/findings` was a separate top-level route with a second auth check and no nav of its own, so
 * the inbox rendered its own copy while the finding's detail page, which lived under `/dashboard`,
 * got the layout's. One feature, two auth gates, two chrome strategies, and a URL shape that
 * changed as you moved between them.
 *
 * The route group `(app)` gives every authenticated route one parent without adding a segment to
 * any URL, so `/dashboard`, `/findings` and `/audits` are all children of this file and none of
 * them can forget to check for a session: a page would have to be physically moved out of the
 * group, which is a visible act rather than an omission.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (!(await getToken())) redirect('/login')

  /**
   * The switcher's options are loaded here, once, rather than per page.
   *
   * A failure is swallowed on purpose: the site list is chrome, and the page below has its own
   * error handling for its own data. Taking the whole screen down because the switcher could not
   * populate would turn a cosmetic problem into an outage.
   */
  let sites: SidebarSite[] = []
  let identity: SignedInIdentity | null = null
  try {
    const api = await getClient()
    if (api) {
      // Both at once: two round trips to a sleeping free instance is twice the cold start, and
      // neither of these blocks the other.
      const [siteList, who] = await Promise.all([api.listSites(), api.getIdentity()])
      sites = siteList.map((site) => ({ id: site.id, url: site.url }))
      identity = who
    }
  } catch {
    sites = []
  }

  return (
    <div className="md:flex">
      <Sidebar sites={sites} identity={identity} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
