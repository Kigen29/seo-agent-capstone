import { ApiRequestError, type ApiClient } from '@seo/api-client'
import { redirect } from 'next/navigation'
import { getClient } from '@/lib/session'
import { toUserError, type UserError } from '@/lib/user-error'

/**
 * What every server action returns: the thing asked for, or one described failure.
 *
 * A discriminated result and never a thrown error, because a thrown error in a server action
 * reaches the browser as Next's generic failure screen with the message stripped in production.
 * The caller cannot forget to handle the failure either: `data` does not exist until `ok` has
 * been checked.
 */
export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: UserError }

/**
 * Run one call to the API on behalf of the signed-in person.
 *
 * `doing` finishes the sentence "We could not ...". A session that has ended goes to sign-in,
 * which is the one failure a message cannot fix; everything else comes back described.
 */
export async function act<T>(
  doing: string,
  work: (api: ApiClient) => Promise<T>,
): Promise<ActionResult<T>> {
  const api = await getClient()
  if (!api) redirect('/login')

  try {
    return { ok: true, data: await work(api) }
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 401) redirect('/login?expired=1')
    return { ok: false, error: toUserError(error, doing) }
  }
}
