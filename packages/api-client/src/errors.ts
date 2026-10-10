/**
 * How a failed request is reported to the caller.
 *
 * Its own file because it is the one thing here that is a value and not a shape: callers test
 * for it with `instanceof`, so it has to be the same class wherever it is imported from.
 */

export interface ApiError {
  status: number
  message: string
}

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /**
     * The API's short name for the failure, when it sent one. Two different refusals share the
     * status 429: 'Rate Limited' means slow down, and anything else means the month's paid
     * allowance is spent. The status alone cannot tell them apart and the words on screen differ.
     */
    readonly code?: string,
  ) {
    super(message)
    this.name = 'ApiRequestError'
  }
}
