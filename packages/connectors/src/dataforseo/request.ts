/**
 * The one place that knows how to talk to DataForSEO.
 *
 * Two product lines are used from this vendor (backlinks and keyword data) and they share an
 * authentication scheme, a base URL, a task envelope and an error convention. Written twice, the
 * second copy would drift, and the thing most likely to drift is the part that decides whether a
 * 200 response actually succeeded.
 *
 * The adapters above this file translate one endpoint's shape each. This file does the transport
 * and nothing else.
 */

export interface DataForSeoCredentials {
  login: string
  password: string
  /**
   * The sandbox returns fabricated data for free. It is the right target for a contract test and
   * for a demo, and the wrong one for a real audit, so it is explicit rather than inferred from
   * whether a key looks like a test key.
   */
  sandbox?: boolean
  /** Injected so a contract test can drive the adapter with no network and no credentials. */
  fetch?: typeof globalThis.fetch
}

const LIVE = 'https://api.dataforseo.com'
const SANDBOX = 'https://sandbox.dataforseo.com'

/** DataForSEO signals success with this code, at both the response and the task level. */
export const OK = 20000

/** The envelope every v3 endpoint returns. Only the parts we read are described. */
export interface DataForSeoEnvelope<T> {
  status_code?: number
  status_message?: string
  tasks?: {
    status_code?: number
    status_message?: string
    result?: T[] | null
  }[]
}

export class DataForSeoError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'DataForSeoError'
  }
}

/**
 * POST one task to a v3 endpoint and return its first result.
 *
 * Returns `null` when the call succeeded and there was simply nothing to report, which is a real
 * answer rather than a failure: a domain with no backlinks at all is a fact about the domain.
 *
 * Failure is checked in three places because DataForSEO can fail in three ways, and only the
 * first is an HTTP error. A transport failure is a non-2xx. A request-level failure is a 200 with
 * a top-level `status_code` that is not 20000. A task-level failure is a 200, a fine top-level
 * code, and a failed task inside it. Checking only the first would turn a broken integration into
 * a silently empty axis, which is the failure mode this product exists to avoid.
 */
export async function postTask<T>(
  credentials: DataForSeoCredentials,
  path: string,
  task: Record<string, unknown>,
): Promise<T | null> {
  const doFetch = credentials.fetch ?? globalThis.fetch
  const base = credentials.sandbox ? SANDBOX : LIVE

  // Basic auth, per the vendor. Built here and never logged: an error string is the most likely
  // thing to reach a log, an issue or a screenshot, and these are live billable credentials.
  const auth = Buffer.from(`${credentials.login}:${credentials.password}`, 'utf8').toString(
    'base64',
  )

  const response = await doFetch(`${base}${path}`, {
    method: 'POST',
    headers: { authorization: `Basic ${auth}`, 'content-type': 'application/json' },
    // The v3 API takes an array of tasks. We send exactly one, because every task is billed and
    // batching would make the budget guard's per-call accounting a lie.
    body: JSON.stringify([task]),
  })

  if (!response.ok) {
    throw new DataForSeoError(
      response.status,
      `DataForSEO returned ${response.status} for ${path}.`,
    )
  }

  const body = (await response.json()) as DataForSeoEnvelope<T>

  if (typeof body.status_code === 'number' && body.status_code !== OK) {
    throw new DataForSeoError(200, `DataForSEO: ${body.status_message ?? 'request failed'}`)
  }

  const [first] = body.tasks ?? []
  if (!first) return null

  if (typeof first.status_code === 'number' && first.status_code !== OK) {
    throw new DataForSeoError(200, `DataForSEO task: ${first.status_message ?? 'task failed'}`)
  }

  return first.result?.[0] ?? null
}

/** Read the credentials from the environment, or undefined when they are not configured. */
export function dataForSeoFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): DataForSeoCredentials | undefined {
  const login = env.DATAFORSEO_LOGIN
  const password = env.DATAFORSEO_PASSWORD
  if (!login || !password) return undefined

  return { login, password, sandbox: env.DATAFORSEO_USE_SANDBOX === 'true' }
}
