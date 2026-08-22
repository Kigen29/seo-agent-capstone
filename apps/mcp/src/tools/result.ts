import { ApiRequestError } from '@seo/api-client'

/**
 * The shape every tool returns, and the one place an API failure becomes readable.
 *
 * Tool failures are returned as content with `isError`, never thrown. A throw becomes a
 * JSON-RPC protocol error, which the model sees as "the server is broken" and cannot act on.
 * A returned error is a result the model can read, understand, and route around, which for
 * something like "connect a repository first" is exactly what should happen: that is not a
 * malfunction, it is an instruction.
 */

/**
 * A type alias rather than an interface, which matters more than it looks.
 *
 * The SDK's tool callback expects a result carrying an index signature. TypeScript gives an
 * implicit index signature to an object *type alias* but never to an interface, on the grounds
 * that an interface can be reopened and augmented later. So the identical shape declared with
 * `interface` fails to assign, with an error naming an index signature nobody wrote.
 */
export type ToolResult = {
  content: { type: 'text'; text: string }[]
  isError?: boolean
}

export const text = (body: string): ToolResult => ({ content: [{ type: 'text', text: body }] })

const errorResult = (body: string): ToolResult => ({
  content: [{ type: 'text', text: body }],
  isError: true,
})

/**
 * Translate a failure into something the caller can act on.
 *
 * The status codes are not incidental. A 404 from this API means "no such thing, for you" and
 * deliberately does not distinguish absent from someone-else's, because a 403 would confirm the
 * row exists and let an attacker enumerate ids (ADR-0009). The message here preserves that
 * ambiguity rather than guessing past it.
 */
function describe(error: unknown): string {
  if (error instanceof ApiRequestError) {
    switch (error.status) {
      case 401:
        return (
          'Not authorised. SEO_API_TOKEN is missing, wrong, or revoked. ' +
          'Mint a new one with: pnpm --filter @seo/api mint-token <tenant-name>'
        )
      case 404:
        return (
          `Not found: ${error.message}. Either it does not exist or it belongs to another ` +
          'tenant; the API does not distinguish those on purpose. Check the id with list_sites ' +
          'or list_findings.'
        )
      case 409:
        return `Refused: ${error.message}`
      case 503:
        return `Not configured on the server: ${error.message}`
      default:
        return `The API returned ${error.status}: ${error.message}`
    }
  }

  /**
   * The free Render instance sleeps after about fifteen minutes and takes 30 to 60 seconds to
   * wake. The client's timeout is set well past that, so a timeout here means something worse
   * than a cold start, and saying "it is probably waking up" would be a guess dressed as help.
   */
  if (error instanceof Error && error.name === 'TimeoutError') {
    return (
      'The API did not respond in time. It may be waking from sleep; try once more. ' +
      'If it keeps happening, check that SEO_API_URL points at a running API.'
    )
  }

  return `Could not reach the API: ${error instanceof Error ? error.message : String(error)}`
}

/** Run a tool body, turning any failure into a readable result rather than a protocol error. */
export async function guard(run: () => Promise<string>): Promise<ToolResult> {
  try {
    return text(await run())
  } catch (error) {
    return errorResult(describe(error))
  }
}
