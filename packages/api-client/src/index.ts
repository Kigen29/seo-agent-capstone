import type { AuditCadence, Finding, SiteSchedule } from '@seo/core'
import { ApiRequestError } from './errors.js'
import type {
  HostingStatus,
  Site,
  EarlierWork,
  FindingQuery,
  FindingPage,
  BulkFixResult,
  AuditHistoryEntry,
  AuditChanges,
  AuditProgress,
  GroundingFact,
  OutreachDraft,
  SignedInIdentity,
  Account,
  ApiCredential,
  FixProgress,
  Audit,
  ConnectRepoResult,
  VisibilitySettings,
  BusinessProfileSettings,
  VisibilityReport,
  KeywordIdeasResult,
  KeywordGapResult,
  FixAttempt,
  SiteOutcomes,
  SiteProfile,
  CompetitorSuggestions,
  Billing,
  CompetitorWatch,
  PromptSuggestions,
  MinedQuestions,
  ContributorSearch,
  KeywordGapQuery,
  KeywordIdeasQuery,
} from './types.js'

/**
 * The typed client. The web app talks to the API through this and never through a raw
 * `fetch`, so a route rename is a compile error rather than a 404 discovered by a user.
 *
 * It holds no database handle and imports no database code. That is enforced by ESLint, not
 * by discipline: `@seo/db` is a restricted import everywhere outside the API and the worker
 * (STORY-013).
 */

export { ApiRequestError } from './errors.js'
export type { ApiError } from './errors.js'
export type * from './types.js'

export interface ApiClientOptions {
  baseUrl: string
  token: string
  /** Injectable so tests do not need a live server, and so Next can pass its own fetch. */
  fetch?: typeof globalThis.fetch
  /** Milliseconds before a request is abandoned. See DEFAULT_TIMEOUT_MS. */
  timeoutMs?: number
}

/**
 * Long enough for Render's free instance to cold-start, short enough that a user is not left
 * staring at a dead page.
 *
 * A client with no timeout at all is what was here first, and it is worse than a slow one: a
 * fetch that never settles means a server action that never returns, a page that renders
 * nothing, and a user with no error, no content, and no idea what is happening. The end-to-end
 * test found it by pointing the app at an API that was not there and watching the sign-in
 * form hang silently forever. In production the same thing happens every time the API has
 * been asleep for fifteen minutes.
 */
const DEFAULT_TIMEOUT_MS = 20_000

/**
 * The two calls that happen before there is a session to authenticate with.
 *
 * Standalone functions rather than methods, because `createApiClient` is built around a bearer
 * token and these run at the exact moment there is not one. Giving the client an optional token
 * to accommodate two unauthenticated calls would weaken the type that currently makes it
 * impossible to build an unauthenticated client by accident.
 */
export async function fetchAuthProviders(
  baseUrl: string,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): Promise<string[]> {
  const response = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/auth/providers`, {
    signal: AbortSignal.timeout(5_000),
  })
  if (!response.ok) throw new ApiRequestError(response.status, 'Sign-in service is unavailable.')
  const body = (await response.json()) as { providers?: unknown }
  if (
    !Array.isArray(body.providers) ||
    !body.providers.every((provider) => typeof provider === 'string')
  ) {
    throw new Error('Invalid sign-in provider response.')
  }
  return body.providers
}

/**
 * Trade a single-use handoff code for the session token it stands for.
 *
 * Returns undefined when the code is unknown, already redeemed, or expired. The API refuses to
 * say which, so neither does this.
 */
export async function exchangeAuthCode(
  baseUrl: string,
  code: string,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): Promise<string | undefined> {
  const response = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/auth/exchange`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code }),
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  })

  if (!response.ok) return undefined

  const body = (await response.json()) as { token?: string }
  return body.token
}

export function createApiClient(options: ApiClientOptions) {
  const doFetch = options.fetch ?? globalThis.fetch
  const base = options.baseUrl.replace(/\/$/, '')
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    /**
     * Composed, not overwritten. Setting `signal` to the timeout alone would silently throw
     * away a caller's own AbortController, so a page that cancels its requests on unmount, or
     * a job that cancels on shutdown, would find its cancellation quietly ignored. Whichever
     * fires first wins, which is what both parties actually meant.
     */
    const timeout = AbortSignal.timeout(timeoutMs)
    const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout

    /**
     * Declare a JSON content-type only when there is actually a JSON body.
     *
     * Setting it unconditionally was a real production bug. A POST with no body, like
     * "start connecting Google", still announced `content-type: application/json`, and
     * Fastify rejects an empty body under that content-type with a 400 ("Body cannot be
     * empty..."). The server action then rethrew the 400 into a Server Components 500 that
     * only showed as a digest. It slipped past the tests because they call the client with a
     * mocked fetch that never parses a body, and past manual curls because curl does not send
     * this header unless you pass data. The header belongs with the payload, so it is set with
     * the payload.
     */
    const headers: Record<string, string> = {
      ...(init.headers as Record<string, string> | undefined),
      authorization: `Bearer ${options.token}`,
    }
    if (init.body !== undefined && init.body !== null) {
      headers['content-type'] = 'application/json'
    }

    const response = await doFetch(`${base}${path}`, { ...init, signal, headers })

    if (!response.ok) {
      /**
       * A 404 from this API means "no such thing, for you", and the client must not try to
       * be clever about whether that is because it does not exist or because it belongs to
       * somebody else. The API refuses to distinguish those on purpose (a 403 would confirm
       * the row is real and let an attacker enumerate ids), so neither does the client.
       */
      const body = (await response.json().catch(() => ({}))) as {
        message?: string
        error?: string
      }
      throw new ApiRequestError(
        response.status,
        body.message ?? response.statusText,
        typeof body.error === 'string' ? body.error : undefined,
      )
    }

    // 204 has no body by definition, and parsing one throws. Sign-out hit this on every call and
    // hid it, because its caller deliberately swallows errors.
    if (response.status === 204) return undefined as T

    return response.json() as Promise<T>
  }

  return {
    health: () => request<{ status: string }>('/health'),

    listSites: async () => (await request<{ sites: Site[] }>('/sites')).sites,
    getHosting: async (siteId: string) => request<HostingStatus>(`/sites/${siteId}/hosting`),
    connectHosting: async (
      siteId: string,
      // Without a project id the project is found from the site's repository.
      input: { token: string; projectId?: string; teamId?: string },
    ) =>
      request<{ connected: boolean }>(`/sites/${siteId}/hosting`, {
        method: 'PUT',
        body: JSON.stringify(input),
      }),

    /** Begin connecting to Vercel by consent. Returns the URL to send the browser to. */
    startVercelConnect: async (siteId: string) =>
      (await request<{ url: string }>(`/sites/${siteId}/hosting/vercel`, { method: 'POST' })).url,
    disconnectHosting: async (siteId: string) =>
      request<{ connected: boolean }>(`/sites/${siteId}/hosting`, { method: 'DELETE' }),

    addSite: async (url: string) =>
      (
        await request<{ site: Site }>('/sites', {
          method: 'POST',
          body: JSON.stringify({ url }),
        })
      ).site,

    /**
     * One page of the findings inbox, filtered and sorted by the server.
     *
     * This took no arguments and returned everything; the browser then filtered the full list.
     * Every parameter here is applied in SQL against an indexed priority score, so a filter click
     * fetches one page instead of re-downloading the tenant's entire backlog.
     */
    listFindings: async (query: FindingQuery = {}) => {
      const params = new URLSearchParams()
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== '') params.set(key, String(value))
      }
      const suffix = params.size > 0 ? `?${params.toString()}` : ''
      return request<FindingPage>(`/findings${suffix}`)
    },

    getAudit: async (id: string) => (await request<{ audit: Audit }>(`/audits/${id}`)).audit,

    /**
     * Status and page count only, for the two-second poll during a crawl. The full `getAudit`
     * carries every finding with its evidence, which is not something to re-fetch twice a minute.
     */
    getAuditProgress: async (id: string) => request<AuditProgress>(`/audits/${id}/progress`),

    /** Every audit of a site, newest first. Earlier audits are kept, never replaced. */
    listSiteAudits: async (siteId: string) =>
      (await request<{ audits: AuditHistoryEntry[] }>(`/sites/${siteId}/audits`)).audits,

    /** What this audit resolved and raised, against the completed audit before it. */
    getAuditChanges: async (id: string) =>
      (await request<{ changes: AuditChanges }>(`/audits/${id}/changes`)).changes,

    /** The account behind the session: who owns it, and what it may spend this month. */
    getAccount: async () => request<Account>('/account'),

    /** Who is signed in, or null for a session minted by hand for the CLI. */
    getIdentity: async () =>
      (await request<{ identity: SignedInIdentity | null }>('/auth/me')).identity,

    /**
     * Revoke the presented token, so signing out means the credential stops working rather than
     * only that this browser forgot it.
     */
    signOut: async () => {
      await request<void>('/auth/signout', { method: 'POST' })
    },

    /** Every live session and token for this account, oldest first. */
    listCredentials: async () =>
      (await request<{ tokens: ApiCredential[] }>('/auth/tokens')).tokens,

    /** Revoke one session or token by id. Revoking the current one signs this caller out. */
    revokeCredential: async (id: string) => {
      await request<void>(`/auth/tokens/${encodeURIComponent(id)}`, { method: 'DELETE' })
    },

    /** Sign out everywhere except this credential. Returns how many were revoked. */
    revokeOtherCredentials: async () =>
      (await request<{ revoked: number }>('/auth/tokens/revoke-others', { method: 'POST' }))
        .revoked,

    /** The fix-flow sibling of `getAuditProgress`: has the pull request landed, or failed? */
    getFixProgress: async (id: string) => request<FixProgress>(`/findings/${id}/fix-progress`),

    /**
     * Draft one outreach email for one publication. Returns null when there is no draft to make.
     *
     * A 422 is the drafter refusing, not a failure: nothing concrete enough to pitch, or no model
     * configured. That is a real answer a person can act on, so it comes back as null rather than
     * as a thrown error a caller would have to pattern-match on a status code to interpret.
     */
    draftOutreach: async (
      siteId: string,
      input: { domain: string; context?: string; facts: GroundingFact[] },
    ) => {
      try {
        return await request<OutreachDraft>(`/sites/${siteId}/outreach`, {
          method: 'POST',
          body: JSON.stringify(input),
        })
      } catch (error) {
        if (error instanceof ApiRequestError && error.status === 422) return null
        throw error
      }
    },

    /** Queue an audit for a site. Returns the new audit's id; the crawl runs on the worker. */
    startAudit: async (siteId: string) =>
      (
        await request<{ auditId: string }>('/audits', {
          method: 'POST',
          body: JSON.stringify({ siteId }),
        })
      ).auditId,

    /** Every attempt the agent made to fix a finding, newest first. */
    getFixAttempts: async (id: string) =>
      (await request<{ attempts: FixAttempt[] }>(`/findings/${id}/attempts`)).attempts,

    getFinding: async (id: string) =>
      (
        await request<{
          finding: Finding & {
            rowId: string
            auditId: string
            firstSeenAt: string
            earlier: EarlierWork | null
          }
        }>(`/findings/${id}`)
      ).finding,

    /**
     * Ask the agent to open a pull request that fixes a finding. Returns the queue status; the
     * worker detects the framework, generates the diff, opens the PR, and marks the finding
     * pr_open with its URL.
     */
    fixFinding: async (id: string) =>
      request<{ status: string }>(`/findings/${id}/fix`, { method: 'POST' }),

    /**
     * Ask for a pull request for several of a site's findings at once: the given ones, or the
     * most important open findings the agent can fix. Each still gets its own pull request.
     */
    fixSiteFindings: async (siteId: string, findingIds?: string[]) =>
      request<BulkFixResult>(`/sites/${siteId}/fixes`, {
        method: 'POST',
        ...(findingIds ? { body: JSON.stringify({ findingIds }) } : {}),
      }),

    /** What this tenant has connected: Google Search Console, and any connected repositories. */
    getConnections: async () =>
      request<{
        google: { connected: boolean; email?: string | null }
        github: { connected: boolean; repos: string[] }
      }>('/connections'),

    /** Begin the Google consent flow. Returns the URL to send the browser to. */
    connectGoogle: async () =>
      (await request<{ url: string }>('/connections/google', { method: 'POST' })).url,

    /**
     * Begin connecting a repository to a site.
     *
     * Two outcomes. When the App is not installed for this tenant yet, `install` carries the
     * GitHub App install URL to send the browser to. When it is already installed, `pick` carries
     * the repositories the App can see, so the user chooses one rather than re-installing (a
     * second install would drop our signed state and look cancelled).
     */
    connectRepo: async (siteId: string) =>
      request<ConnectRepoResult>('/connections/github', {
        method: 'POST',
        body: JSON.stringify({ siteId }),
      }),

    /** Bind a repository the App can already see to a site. Used by the picker. */
    setSiteRepo: async (siteId: string, repoFullName: string) =>
      request<{ repoFullName: string }>(`/sites/${siteId}/repo`, {
        method: 'POST',
        body: JSON.stringify({ repoFullName }),
      }),

    /**
     * Queue a Search Console auto-verification PR for a site. The worker creates the property,
     * fetches the token, and opens the PR that adds the verification meta tag.
     */
    verifySite: async (siteId: string) =>
      request<{ status: string }>(`/sites/${siteId}/verify`, { method: 'POST' }),

    /**
     * Keyword ideas for a seed term.
     *
     * The only read in this client that costs money. It passes the tenant's budget guard on the
     * server, so a caller over its cap gets a 429 rather than a bill, and an unconfigured
     * deployment gets an empty list with a note rather than an error.
     */
    keywordIdeas: async (query: KeywordIdeasQuery) => {
      const params = new URLSearchParams()
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== '') params.set(key, String(value))
      }
      return request<KeywordIdeasResult>(`/keywords/ideas?${params.toString()}`)
    },

    /**
     * What a competitor ranks for that this site does not, with the keywords it already appears
     * for subtracted using its own Search Console data.
     *
     * `subtracted: null` on the result means that correction did not run, so the list is the
     * vendor's raw view and will contain terms the site already ranks for.
     */
    keywordGap: async ({ siteId, ...query }: KeywordGapQuery) => {
      const params = new URLSearchParams()
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== '') params.set(key, String(value))
      }
      return request<KeywordGapResult>(`/sites/${siteId}/keywords/gap?${params.toString()}`)
    },

    /**
     * The AI-visibility numbers: citation rate, stability per prompt, and share of voice.
     *
     * Read live from the poll checks rather than the last audit, because the saga writes a row a
     * day between audits. A `note` on the result means there is nothing to report yet and says
     * which kind of nothing it is.
     */
    getVisibilityReport: async (siteId: string) =>
      request<VisibilityReport>(`/sites/${siteId}/visibility/report`),

    /**
     * The questions this site's customers actually ask: Search Console's question queries, plus
     * People Also Ask when a seed is given (one billed query) and a SERP vendor is configured.
     */
    /** Every fix proposed for a site and whether it worked. */
    getOutcomes: async (siteId: string) => request<SiteOutcomes>(`/sites/${siteId}/outcomes`),

    /** What ran, what is due and what is coming for a site, for one month (`YYYY-MM`). */
    getSchedule: async (siteId: string, month?: string) =>
      request<SiteSchedule>(
        `/sites/${siteId}/schedule${month ? `?month=${encodeURIComponent(month)}` : ''}`,
      ),

    /** How often a site is audited without anybody asking. */
    setAuditCadence: async (siteId: string, cadence: AuditCadence) =>
      (
        await request<{ auditCadence: AuditCadence }>(`/sites/${siteId}/audit-cadence`, {
          method: 'PUT',
          body: JSON.stringify({ cadence }),
        })
      ).auditCadence,

    getSiteProfile: async (siteId: string) => request<SiteProfile>(`/sites/${siteId}/profile`),

    saveSiteProfile: async (
      siteId: string,
      profile: { brand?: string | null; offering?: string | null; market?: string | null },
    ) =>
      request<SiteProfile>(`/sites/${siteId}/profile`, {
        method: 'PUT',
        body: JSON.stringify(profile),
      }),

    /** Replace the tracked competitors, and nothing else. */
    saveCompetitors: async (siteId: string, competitors: string[]) =>
      (
        await request<{ competitors: string[] }>(`/sites/${siteId}/competitors`, {
          method: 'PUT',
          body: JSON.stringify({ competitors }),
        })
      ).competitors,

    /** Set the name a tracked competitor goes by, or clear it with null. */
    saveCompetitorName: async (siteId: string, domain: string, name: string | null) =>
      (
        await request<{ competitorNames: Record<string, string | null> }>(
          `/sites/${siteId}/competitor-names`,
          { method: 'PUT', body: JSON.stringify({ domain, name }) },
        )
      ).competitorNames,

    /** Replace the sites that are not about this business. They leave its mentions at once. */
    saveMentionExclusions: async (siteId: string, domains: string[]) =>
      (
        await request<{ mentionExclusions: string[] }>(`/sites/${siteId}/mention-exclusions`, {
          method: 'PUT',
          body: JSON.stringify({ domains }),
        })
      ).mentionExclusions,

    /** Draft competitors from what the site offers and where. One model call; nothing is saved. */
    suggestCompetitors: async (siteId: string) =>
      request<CompetitorSuggestions>(`/sites/${siteId}/competitors/suggestions`, {
        method: 'POST',
      }),

    /** Which plan this account is on, and the plans there are. */
    getBilling: async () => request<Billing>('/billing'),

    /** Start a checkout for a paid plan. Returns the payment rail's address to send the browser to. */
    startCheckout: async (planId: string) =>
      (
        await request<{ url: string }>('/billing/checkout', {
          method: 'POST',
          body: JSON.stringify({ planId }),
        })
      ).url,

    /** What a site's tracked competitors changed, beside their AI citations before and after. */
    getCompetitorWatch: async (siteId: string) =>
      request<CompetitorWatch>(`/sites/${siteId}/competitor-watch`),

    /** Draft AI-visibility questions for a site from what it says about itself. One model call. */
    suggestPrompts: async (siteId: string) =>
      request<PromptSuggestions>(`/sites/${siteId}/visibility/suggestions`, { method: 'POST' }),

    mineQuestions: async (siteId: string, query: { seed?: string; country?: string } = {}) => {
      const params = new URLSearchParams()
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== '') params.set(key, String(value))
      }
      return request<MinedQuestions>(`/sites/${siteId}/questions?${params.toString()}`)
    },

    /** The questions this site's AI visibility is measured on, and the rivals it is measured against. */
    getVisibility: async (siteId: string) =>
      request<VisibilitySettings>(`/sites/${siteId}/visibility`),

    /**
     * Replace a site's prompts and competitors. Returns what was actually stored, which may be
     * tidier than what was sent (trimmed, deduplicated, competitors reduced to bare hosts), so a
     * caller should render the response rather than its own input.
     */
    setVisibility: async (siteId: string, settings: VisibilitySettings) =>
      request<VisibilitySettings>(`/sites/${siteId}/visibility`, {
        method: 'PUT',
        body: JSON.stringify(settings),
      }),

    /**
     * Places that might publish this client, checked before they are shown.
     *
     * Mention building, not link building: the ask is coverage, and anything selling placements
     * is refused and named. Each call runs billed searches, which is why it is a POST.
     */
    findContributors: async (
      siteId: string,
      body: { niche: string; locale?: string; country?: string },
    ) =>
      request<ContributorSearch>(`/sites/${siteId}/contributors`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),

    /** The Google Business Profile connected to this site, with the links derived from it. */
    getBusinessProfile: async (siteId: string) =>
      request<BusinessProfileSettings>(`/sites/${siteId}/business-profile`),

    /**
     * Connect a business profile from a Google Maps share link, or clear it with null.
     *
     * The API follows the link, so what comes back is what was actually found in it rather than
     * what was pasted. A link carrying no identifier is a 400 explaining how to get one.
     */
    setBusinessProfile: async (siteId: string, mapsUrl: string | null) =>
      request<BusinessProfileSettings>(`/sites/${siteId}/business-profile`, {
        method: 'PUT',
        body: JSON.stringify({ mapsUrl }),
      }),
  }
}

export type ApiClient = ReturnType<typeof createApiClient>
