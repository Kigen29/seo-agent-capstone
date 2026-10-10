'use server'

import type { AuditCadence } from '@seo/api-client'
import { revalidatePath } from 'next/cache'
import { act, type ActionResult } from '@/lib/action'

/** Turn scheduled audits on, off, or to another interval. Takes effect on the worker's next wake. */
export async function setAuditCadence(
  siteId: string,
  cadence: AuditCadence,
): Promise<ActionResult<AuditCadence>> {
  const result = await act('change how often this site is audited', (api) =>
    api.setAuditCadence(siteId, cadence),
  )
  if (result.ok) revalidatePath('/schedule')
  return result
}
