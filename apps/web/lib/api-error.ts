import { ApiRequestError } from '@seo/api-client'
import { notFound, redirect } from 'next/navigation'

/**
 * What a page should do when the API says no.
 *
 * Returns only when the right answer is "render the API-is-waking page". Every other case
 * leaves through a throw (`redirect` and `notFound` both work that way in Next), so a caller
 * cannot forget to handle one.
 */
/**
 * Gateway statuses that mean "the API is not up right now", not "the API said no".
 *
 * This is the fix for a real production 500. A full cold start takes longer than the client
 * timeout, so it surfaces as a network abort (handled below). But Render's edge also answers
 * a 502 or 503 while the instance is still coming up, and that is an HTTP response, so the
 * client turns it into an ApiRequestError. Treating it like any other error rethrew it, and
 * the dashboard crashed with a Server Components 500 instead of showing the waking page.
 * These three statuses are infrastructure, not our API refusing the request, so they get the
 * same graceful treatment as a dropped connection.
 */
const GATEWAY_UNAVAILABLE = new Set([502, 503, 504])

export function handleApiError(error: unknown): void {
  if (!(error instanceof ApiRequestError)) {
    // Not an HTTP error at all: the fetch never landed. On the free tier the overwhelmingly
    // likely reason is that Render has spun the API down and is waking it.
    return
  }

  // A cold-starting or briefly unavailable API. Render the waking page, do not crash the render.
  if (GATEWAY_UNAVAILABLE.has(error.status)) return

  /**
   * The token is gone, revoked, or was never good.
   *
   * This used to be a 500, and it was a real bug: the dashboard layout checks only that a
   * session cookie *exists*, so a stale token walked straight past the gate and exploded in
   * the page. A user whose token had been revoked would have seen a crash instead of a
   * sign-in screen, which reads as "the product is broken" rather than "sign in again".
   *
   * The cookie is deliberately not cleared here. Next only permits cookie writes in server
   * actions and route handlers, never during a render, so clearing it would throw a second,
   * more confusing error on top of the first. Signing in overwrites it, and signing out
   * deletes it.
   */
  if (error.status === 401) redirect('/login?expired=1')

  /**
   * "No such thing, for you." The API refuses to distinguish "does not exist" from "belongs
   * to another tenant" (ADR-0009), because a 403 would confirm the row is real and let an
   * attacker enumerate ids. Rendering a "you do not have permission" page here would leak
   * exactly the fact the API took care not to. So we say what it says: not found.
   */
  if (error.status === 404) notFound()

  throw error
}
