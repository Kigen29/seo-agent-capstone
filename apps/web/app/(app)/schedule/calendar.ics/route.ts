import { ApiRequestError } from '@seo/api-client'
import { toIcs } from '@seo/core'
import type { NextRequest } from 'next/server'
import { hostOf } from '@/lib/format'
import { getClient } from '@/lib/session'

/**
 * The month's upcoming runs as a calendar file, for a person's own calendar.
 *
 * A download, not a feed to subscribe to. A feed has to be readable by a calendar service with
 * no session, which means a secret in the address that grants a view of the account to anybody
 * who sees the link. A file the signed-in person downloads needs no such thing.
 *
 * Only what is still to come goes in the file. What has already run is a record, and belongs on
 * the page, not as a reminder in somebody's past.
 *
 * A route handler is not wrapped by the `(app)` layout, so the session is checked here.
 */
export const dynamic = 'force-dynamic'

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const plain = (status: number, message: string) =>
  new Response(message, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } })

export async function GET(request: NextRequest): Promise<Response> {
  const api = await getClient()
  if (!api) return plain(401, 'Sign in to download this calendar.')

  const siteId = request.nextUrl.searchParams.get('siteId') ?? ''
  const month = request.nextUrl.searchParams.get('month') ?? undefined
  if (!UUID.test(siteId) || (month !== undefined && !MONTH.test(month))) {
    return plain(400, 'That is not a site and a month.')
  }

  try {
    const [sites, schedule] = await Promise.all([api.listSites(), api.getSchedule(siteId, month)])
    const site = sites.find((candidate) => candidate.id === siteId)
    const host = site ? hostOf(site.url) : 'your site'
    const events = schedule.events
      .filter((event) => event.state === 'due' || event.state === 'scheduled')
      .map((event) => ({
        ...event,
        ...(event.href
          ? { href: `${event.href}${event.href.includes('?') ? '&' : '?'}siteId=${siteId}` }
          : {}),
      }))

    return new Response(
      toIcs(events, { site: host, origin: request.nextUrl.origin, now: new Date() }),
      {
        headers: {
          'content-type': 'text/calendar; charset=utf-8',
          'content-disposition': `attachment; filename="rankwright-${host}-${schedule.month}.ics"`,
          'cache-control': 'private, no-store',
        },
      },
    )
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 401) {
      return plain(401, 'Sign in to download this calendar.')
    }
    if (error instanceof ApiRequestError && (error.status === 404 || error.status === 400)) {
      return plain(404, 'There is no calendar at this address.')
    }
    return plain(503, 'The service is starting up. Try again in a moment.')
  }
}
