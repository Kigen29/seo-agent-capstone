import { ApiRequestError } from '@seo/api-client'

/**
 * One way to turn a failure into something a person can act on.
 *
 * Every form in the app used to write its own sentence for the same handful of failures, in its
 * own words and its own font size: "Could not reach the API. It may be waking up", "Could not
 * save the prompts. Try again shortly", a bare status text. The failures are few and the same
 * everywhere, so they are named once here, and every screen shows them through `<ErrorNote>`.
 *
 * Each has two parts because they answer two questions: what happened, and what to do about it.
 * A message that only says what happened leaves somebody staring at it.
 */
export type UserErrorKind = 'waking' | 'invalid' | 'budget' | 'unavailable' | 'not_found' | 'failed'

export interface UserError {
  kind: UserErrorKind
  /** What happened, in a few words. */
  title: string
  /** What it means and what to do next. */
  detail: string
}

/** Gateways answer with these while the free API instance is starting. */
const WAKING = new Set([502, 504])

/**
 * Describe a failure. `doing` finishes the sentence "We could not ...", for example
 * "save your competitors".
 *
 * The API's own message is used when the API chose it for a person to read (a bad input, a
 * feature that is switched off, a budget that is spent). It is never used for a server fault,
 * where the message is for a log and the honest thing to say is that it is our problem.
 */
export function toUserError(error: unknown, doing: string): UserError {
  if (error instanceof ApiRequestError) {
    const said = error.message?.trim()

    // A 409 is the API refusing because something else has to be true first, in words it chose.
    if (error.status === 400 || error.status === 409 || error.status === 422) {
      return {
        kind: 'invalid',
        title: `We could not ${doing}`,
        detail:
          said ||
          'Something in what was entered is not in the shape expected. Check it and try again.',
      }
    }

    if (error.status === 429) {
      return {
        kind: 'budget',
        title: 'This month’s paid allowance is used up',
        detail:
          said ||
          'Paid work is paused until the month resets or the cap is raised. Everything free still works.',
      }
    }

    if (error.status === 404) {
      return {
        kind: 'not_found',
        title: 'That is no longer there',
        detail:
          'It may have been removed, or it belongs to another account. Go back and try again.',
      }
    }

    // A 503 with words in it is the API saying a feature is off; without, it is still starting.
    if (error.status === 503 && said && said !== 'Service Unavailable') {
      return { kind: 'unavailable', title: 'This is not switched on', detail: said }
    }

    if (WAKING.has(error.status) || error.status === 503) {
      return {
        kind: 'waking',
        title: 'The service is starting up',
        detail:
          'It sleeps after about fifteen minutes without use and takes up to a minute to start. Nothing was lost. Try again in a moment.',
      }
    }
  }

  // A timeout or a dropped connection looks the same from here as an instance that is starting.
  if (error instanceof Error && /abort|timeout|fetch failed|network/i.test(error.message)) {
    return {
      kind: 'waking',
      title: 'The service did not answer in time',
      detail:
        'It may be starting up, which takes up to a minute. Nothing was lost. Try again in a moment.',
    }
  }

  return {
    kind: 'failed',
    title: `We could not ${doing}`,
    detail:
      'That is a fault on our side, not something you did. Try again, and if it keeps happening the problem is ours to fix.',
  }
}

/** For a check done in the browser before anything is sent. */
export const invalid = (title: string, detail: string): UserError => ({
  kind: 'invalid',
  title,
  detail,
})
