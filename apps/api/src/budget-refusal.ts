import type { FastifyReply } from 'fastify'

/**
 * Say which limit stopped a paid call, in words that point at the right fix.
 *
 * The budget guard refuses for three different reasons and they have three different owners.
 * They used to be reported as one: "this account has used its monthly allowance". That sent an
 * operator to raise an account's cap, which changed nothing, because the limit that was actually
 * reached was the one shared by the whole installation.
 *
 *   - **The account's own cap.** Fixed under Settings, Account, or by waiting for the 1st.
 *   - **The installation's shared cap.** One figure across every account, set by whoever runs
 *     the deployment. No account setting touches it.
 *   - **The ledger could not be read or written.** Nothing is used up; the guard fails closed
 *     because guessing in the other direction costs real money. Trying again is the fix.
 *
 * Returns undefined when the error is not a budget refusal at all, so a route can fall through
 * to its own handling.
 */
const PREFIX = 'Budget guard:'

export function sendBudgetRefusal(
  reply: FastifyReply,
  error: unknown,
  /** What was not done, to finish "so no ...". For example "competitors were suggested". */
  notDone: string,
  /** What the person can still do without a paid call, if anything. A whole sentence. */
  instead = '',
): FastifyReply | undefined {
  const message = error instanceof Error ? error.message : String(error)
  if (!message.startsWith(PREFIX)) return undefined

  const also = instead ? ` ${instead}` : ''

  if (/global budget/i.test(message)) {
    return reply.status(429).send({
      error: 'Too Many Requests',
      message:
        `This installation's shared monthly allowance for paid features is used up, so no ${notDone}. ` +
        'It is one limit across every account, separate from your own cap, and it is set by ' +
        'whoever runs the installation (GLOBAL_MONTHLY_BUDGET_MICROS). Raising an account cap ' +
        'does not change it. It resets on the 1st.' +
        also,
    })
  }

  if (/tenant budget|monthly budget|monthly cap/i.test(message)) {
    return reply.status(429).send({
      error: 'Too Many Requests',
      message:
        `This account has used its monthly allowance for paid features, so no ${notDone}. ` +
        'That counts calls still in progress and calls that failed without a clear answer. ' +
        'The cap is shown under Settings, Account.' +
        also,
    })
  }

  // The reservation could not be made or the ledger could not be read. Not a spent allowance.
  return reply.status(502).send({
    error: 'Bad Gateway',
    message:
      `The allowance could not be checked just now, so no ${notDone}. Nothing has been used up. ` +
      'Try again in a moment.' +
      also,
  })
}
