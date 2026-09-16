'use server'

import type { OutreachDraft } from '@seo/api-client'
import { getClient } from '@/lib/session'

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
 */
export type OutreachState =
  | { status: 'idle' }
  | { status: 'drafted'; result: OutreachDraft }
  | { status: 'none'; message: string }
  | { status: 'error'; message: string }

export async function draftOutreachAction(
  _previous: OutreachState,
  formData: FormData,
): Promise<OutreachState> {
  const siteId = String(formData.get('siteId') ?? '')
  const domain = String(formData.get('domain') ?? '')
  const claim = String(formData.get('claim') ?? '').trim()
  const sourceUrl = String(formData.get('sourceUrl') ?? '').trim()
  const context = String(formData.get('context') ?? '').trim()

  if (!siteId || !domain)
    return { status: 'error', message: 'Missing the site or the publication.' }
  if (!claim || !sourceUrl) {
    return {
      status: 'none',
      message:
        'A pitch needs one concrete fact and somewhere it can be checked. Without both this ' +
        'would be a template, and a template is what every other outreach tool already sends.',
    }
  }

  const api = await getClient()
  if (!api) return { status: 'error', message: 'Your session has expired. Sign in again.' }

  try {
    const result = await api.draftOutreach(siteId, {
      domain,
      ...(context ? { context } : {}),
      facts: [{ claim, sourceUrl }],
    })

    // Null is the drafter refusing, which is a real answer rather than a failure. See the client.
    if (!result) {
      return {
        status: 'none',
        message:
          'No draft. There was nothing specific enough to pitch this publication, or no model ' +
          'is configured. That is a better answer than a generic email sent under your name.',
      }
    }

    return { status: 'drafted', result }
  } catch {
    return {
      status: 'error',
      message: 'Could not reach the drafter. The API may be waking up; try again in a moment.',
    }
  }
}
