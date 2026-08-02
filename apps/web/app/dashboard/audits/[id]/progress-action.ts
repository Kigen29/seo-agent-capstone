'use server'

import type { AuditProgress } from '@seo/api-client'
import { getClient } from '@/lib/session'

/**
 * Read an audit's status and page count.
 *
 * A server action rather than a route handler, because the API token lives in an httpOnly cookie
 * that the browser cannot read: the poll has to run on the server either way. This is the whole
 * payload of a two-second poll now, in place of a full page re-render that re-serialised every
 * finding's evidence.
 *
 * Returns null on any failure. The poll is cosmetic; if the API is briefly unreachable the right
 * behaviour is to keep the last known count on screen and try again in two seconds, not to throw
 * an error into a component whose only job is to show a number.
 */
export async function fetchAuditProgress(auditId: string): Promise<AuditProgress | null> {
  const api = await getClient()
  if (!api) return null

  try {
    return await api.getAuditProgress(auditId)
  } catch {
    return null
  }
}
