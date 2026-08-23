import { z } from 'zod'

/** Every :id in this API is a uuid, and a route that does not say so accepts anything. */
export const uuidParam = z.object({ id: z.string().uuid() })

/**
 * 404, never 403, for a resource belonging to another tenant.
 *
 * This is the whole difference between "you may not see this" and "this does not exist", and
 * it matters more than it looks. A 403 confirms the row is real: an attacker who can tell
 * 403 from 404 can enumerate which audit ids exist across the whole platform, learn how many
 * customers we have and how active they are, and confirm that a specific competitor is a
 * customer. All without ever reading a single byte of anyone's data.
 *
 * Row-level security makes this natural rather than something to remember: the query simply
 * returns no rows, so the handler cannot tell "not yours" from "not there" either. The code
 * is honest because it genuinely does not know.
 */
export const notFound = (reply: { status: (code: number) => { send: (body: unknown) => unknown } }) =>
  reply.status(404).send({ error: 'Not Found' })
