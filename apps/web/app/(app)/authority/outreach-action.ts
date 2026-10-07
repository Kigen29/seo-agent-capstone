'use server'

import type { OutreachDraft } from '@seo/api-client'
import { act, type ActionResult } from '@/lib/action'

/**
 * Ask the agent to draft one pitch, for one publication, from one fact the human supplied.
 *
 * There is no send here, and there is no send anywhere downstream of here. CLAUDE.md rule 6 is
 * not a policy this action enforces with a check; it is a capability the code does not have. The
 * result is text on a screen, and the next step is a person selecting it.
 *
 * The fact comes from the form rather than from us, because it is the one input we cannot
 * generate honestly. The whole argument for this feature is that a pitch needs one specific,
 * true thing nobody else has, and the only party who knows that thing is the client.
 *
 * `null` is the drafter declining, which is an answer and not a failure: there was nothing
 * specific enough to pitch, and a generic email under the client's name is worse than none.
 */
export interface OutreachInput {
  domain: string
  claim: string
  sourceUrl: string
  context?: string
}

export async function draftOutreach(
  siteId: string,
  input: OutreachInput,
): Promise<ActionResult<OutreachDraft | null>> {
  return act('write that draft', async (api) => {
    const context = input.context?.trim()
    const result = await api.draftOutreach(siteId, {
      domain: input.domain,
      ...(context ? { context } : {}),
      facts: [{ claim: input.claim.trim(), sourceUrl: input.sourceUrl.trim() }],
    })
    return result ?? null
  })
}
