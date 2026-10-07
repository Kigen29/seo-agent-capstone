'use client'

import { usePathname, useSearchParams } from 'next/navigation'

/**
 * Which site the shell is showing, worked out once for the sidebar and the top bar.
 *
 * The site is the `siteId` in the query string when there is one. Pages that are about exactly one
 * site fall back to the first when it is absent, which is what those pages do themselves; the
 * inbox and the audit history do not, because for them no `siteId` means every site.
 */
const SITE_VIEWS = ['/dashboard', '/keywords', '/authority', '/visibility', '/outcomes']

export function useActiveSite(sites: { id: string }[]) {
  const pathname = usePathname() ?? ''
  const params = useSearchParams()

  const isSiteView = SITE_VIEWS.includes(pathname)
  const activeSite = params.get('siteId') ?? (isSiteView ? sites[0]?.id : undefined)

  return { pathname, isSiteView, activeSite }
}
