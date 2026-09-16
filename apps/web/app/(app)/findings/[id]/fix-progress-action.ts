'use server'

import type { FixProgress } from '@seo/api-client'
import { getClient } from '@/lib/session'

/**
 * Read whether a finding's fix job has produced a pull request yet.
 *
 * A server action rather than a route handler, for the same reason as `fetchAuditProgress`: the
 * API token lives in an httpOnly cookie the browser cannot read, so the poll has to run on the
 * server either way.
 *
 * Returns null on any failure. The poll is cosmetic; the authoritative state is on the page and
 * a reload will always show it. If the API is briefly unreachable, and on this stack it will be,
 * the right behaviour is to keep waiting rather than to throw an error into a component whose
 * only job is to say whether a pull request has appeared.
 */
export async function fetchFixProgress(findingId: string): Promise<FixProgress | null> {
  const api = await getClient()
  if (!api) return null

  try {
    return await api.getFixProgress(findingId)
  } catch {
    return null
  }
}
