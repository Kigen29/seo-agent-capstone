'use server'

import { act, type ActionResult } from '@/lib/action'

/** Replace the list of sites that are not about this business. Returns what was stored. */
export async function setMentionExclusions(
  siteId: string,
  domains: string[],
): Promise<ActionResult<string[]>> {
  return act('update that list', (api) => api.saveMentionExclusions(siteId, domains))
}
