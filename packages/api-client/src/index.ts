import type { Finding, Scorecard } from '@seo/core'

/**
 * The typed client. The web app talks to the API through this and never through a raw
 * `fetch`, so a route rename is a compile error rather than a 404 discovered by a user.
 *
 * It holds no database handle and imports no database code. That is enforced by ESLint, not
 * by discipline: `@seo/db` is a restricted import everywhere outside the API and the worker
 * (STORY-013).
 */

export interface ApiError {
  status: number
  message: string
}

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiRequestError'
  }
}

export interface AuditSummary {
  id: string
  status: string
  pagesCrawled: number
  startedAt: string
  scorecard: Scorecard | null
}

export interface Site {
  id: string
  url: string
  latestAudit?: AuditSummary
}

export interface Audit {
  id: string
  siteId: string
  siteUrl: string
  status: string
  pagesCrawled: number
  startedAt: string
  completedAt: string | null
  error: string | null
  scorecard: Scorecard | null
  findings: (Finding & { rowId: string })[]
}

export interface ApiClientOptions {
  baseUrl: string
  token: string
  /** Injectable so tests do not need a live server, and so Next can pass its own fetch. */
  fetch?: typeof globalThis.fetch
}

export function createApiClient(options: ApiClientOptions) {
  const doFetch = options.fetch ?? globalThis.fetch
  const base = options.baseUrl.replace(/\/$/, '')

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await doFetch(`${base}${path}`, {
      ...init,
      headers: {
        ...init.headers,
        authorization: `Bearer ${options.token}`,
        'content-type': 'application/json',
      },
    })

    if (!response.ok) {
      /**
       * A 404 from this API means "no such thing, for you", and the client must not try to
       * be clever about whether that is because it does not exist or because it belongs to
       * somebody else. The API refuses to distinguish those on purpose (a 403 would confirm
       * the row is real and let an attacker enumerate ids), so neither does the client.
       */
      const body = (await response.json().catch(() => ({}))) as { message?: string }
      throw new ApiRequestError(response.status, body.message ?? response.statusText)
    }

    return response.json() as Promise<T>
  }

  return {
    health: () => request<{ status: string }>('/health'),

    listSites: async () => (await request<{ sites: Site[] }>('/sites')).sites,

    addSite: async (url: string) =>
      (
        await request<{ site: Site }>('/sites', {
          method: 'POST',
          body: JSON.stringify({ url }),
        })
      ).site,

    getAudit: async (id: string) => (await request<{ audit: Audit }>(`/audits/${id}`)).audit,

    getFinding: async (id: string) =>
      (await request<{ finding: Finding & { rowId: string; auditId: string } }>(`/findings/${id}`))
        .finding,
  }
}

export type ApiClient = ReturnType<typeof createApiClient>
