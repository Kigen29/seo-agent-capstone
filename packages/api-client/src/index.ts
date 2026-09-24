import type { Axis, Effort, Finding, FindingStatus, Scorecard, Severity } from '@seo/core'

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
  /** The connected repository, "owner/name", or null until a repo is connected. */
  repoFullName?: string | null
  /** Where the site is in the Search Console verification lifecycle. */
  gscVerificationStatus?: 'none' | 'pr_open' | 'merged' | 'verified'
  /** The open (or merged) pull request that adds the verification meta tag, if any. */
  gscVerificationPrUrl?: string | null
  latestAudit?: AuditSummary
}

/**
 * One row of the findings inbox. Matches the API's list-findings shape.
 *
 * `affectedUrls` used to be here as a full array and is now a count. It was serialised into every
 * inbox response for a column the list never rendered, which on a real tenant is megabytes to
 * draw a table of titles.
 */
export interface FindingListItem {
  rowId: string
  siteId: string
  siteUrl: string
  ruleId: string
  axis: Axis
  severity: Severity
  title: string
  fixable: boolean
  status: FindingStatus
  estimatedImpact: number
  estimatedEffort: Effort
  affectedUrlCount: number
  /** Whether the last attempt to fix this failed. The reason is on the finding itself. */
  fixFailed: boolean
}

/** What the inbox can be narrowed and ordered by. All optional; the API validates and bounds them. */
export interface FindingQuery {
  siteId?: string
  axis?: Axis
  severity?: Severity
  status?: FindingStatus
  fixable?: boolean
  q?: string
  sort?: 'priority' | 'severity' | 'title' | 'axis'
  page?: number
  pageSize?: number
}

/** One page of findings, plus the total so the UI can render page numbers and a real count. */
export interface FindingPage {
  findings: FindingListItem[]
  total: number
  page: number
  pageSize: number
}

/** Two scalars, for the poll that runs while a crawl is in flight. */
export interface AuditProgress {
  id: string
  status: string
  pagesCrawled: number
  /** True once there is nothing left to poll for, so the client can stop. */
  finished: boolean
}

/**
 * A drafted outreach email, and the facts it was built on. Never a sent one.
 *
 * `sendPolicy` is carried on the payload rather than being a rule the UI is trusted to remember,
 * so a screen cannot render a draft without the caveat that a human sends it (CLAUDE.md rule 6).
 */
export interface GroundingFact {
  claim: string
  sourceUrl: string
}

export interface OutreachDraft {
  draft: { subject: string; body: string; angle: string }
  sendPolicy: string
  groundedOn: GroundingFact[]
}

/** Who is signed in, for the dashboard to show. Null when the session is a hand-minted token. */
export interface SignedInIdentity {
  provider: string
  email: string | null
  name: string | null
  avatarUrl: string | null
}

/**
 * The account behind the session, for the profile and settings screens.
 *
 * The budget is in micro-dollars, like everywhere else it appears, and is formatted once at the
 * edge. Money is never a float in this codebase: a `fast` call costs fractions of a cent and
 * thousands of them have to sum without drift, which an integer gives by construction.
 */
export interface Account {
  tenantName: string | null
  createdAt: string | null
  identity: SignedInIdentity | null
  budget: { capMicros: number; spentMicros: number; reservedMicros?: number; allowed: boolean }
}

/** The three scalars the finding page polls while a fix job is in flight. */
export interface FixProgress {
  id: string
  status: string
  prUrl: string | null
  fixError: string | null
  /** True once there is nothing left to poll for, so the client can stop. */
  finished: boolean
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
  /** What each axis measured. Null on audits run before the column existed. */
  metrics: AuditMetrics | null
  findings: (Finding & { rowId: string })[]
}

/** A repository the connected GitHub App can see, for the picker. */
export interface PickableRepo {
  fullName: string
  installationId: number
}

/** The two ways connecting a repo can begin: a fresh install, or a pick from an existing one. */
export type ConnectRepoResult =
  { mode: 'install'; url: string } | { mode: 'pick'; repos: PickableRepo[]; manageUrl: string }

/**
 * What a site's AI-visibility axis is configured to measure: the customer questions we poll the
 * answer engines with, and the competitor hosts share of voice is computed against.
 */
export interface VisibilitySettings {
  prompts: string[]
  competitors: string[]
  /**
   * The brand name as a human writes it, for the authority axis. Null until somebody says.
   *
   * It travels with the prompts because it is the same kind of thing: a fact about the business
   * no crawl can discover and no heuristic can guess, typed once and measured against by two
   * different axes.
   */
  brand: string | null
}

/**
 * The Google Business Profile a site belongs to, and what can be built from it.
 *
 * The stored halves and the derived halves travel together so no caller has to know how a profile
 * link is shaped: `cid` and `placeId` are what we hold, `mapsUrl` and `reviewUrl` are what they
 * make. All four are null for a site with no profile connected, which is a real state and not an
 * error, since plenty of sites are not local businesses.
 */
export interface BusinessProfileSettings {
  cid: string | null
  placeId: string | null
  mapsUrl: string | null
  reviewUrl: string | null
}

/** One prompt's poll window: how often we asked, over how many days, and how often we were cited. */
export interface PromptSummary {
  prompt: string
  pollsRun: number
  daysPolled: number
  citedCount: number
  /** citedCount / pollsRun. The plain "cited in k of N" a reader can check. */
  citationRate: number
  /** `insufficient` means not enough polls, or not over enough days, to say anything yet. */
  stability: 'insufficient' | 'unstable' | 'stable' | 'absent'
}

export interface ShareOfVoice {
  client: number
  competitors: { domain: string; citations: number }[]
  /** The client's citations as a fraction of all cited brands'. 0 when nobody was cited. */
  clientShare: number
}

/**
 * The AI-visibility numbers for a site.
 *
 * `note` is present exactly when there is nothing to report, and says which kind of nothing: no
 * prompts configured, none polled yet, or polling but short of a verdict. Those are three
 * different answers and none of them is a zero.
 */
export interface VisibilityReport {
  windowDays: number
  promptsConfigured: number
  promptsMeasured: number
  checksRun: number
  daysPolled: number
  engines: string[]
  prompts: PromptSummary[]
  /** Null when no competitors are configured, which is not a zero share. */
  share: ShareOfVoice | null
  note?: string
}

/** What the authority axis measured on an audit. */
export interface AuthorityMetrics {
  /** Null when no backlink index is configured. NOT the same as a site with no backlinks. */
  referringDomains: number | null
  referringDomainsSampled?: number
  earnedDomains: number
  selfPublishedDomains: number
  /** Domains that mention the brand without linking. Undefined when links were never checked. */
  unlinkedMentions?: string[]
  /**
   * The link gap: sites linking to every tracked competitor and not to this one.
   *
   * Only the editorial domains are listed, because they are the only ones worth an email. The
   * refused count travels with them so the filtering can be seen rather than trusted: on a small
   * site most of this list is usually link farms, and a tool that printed them as opportunities
   * would be recommending a link scheme.
   */
  linkGap?: {
    editorialDomains: string[]
    refusedAsSpam: number
    directoryDomains: string[]
    comparedWith: string[]
  }
}

export interface SearchMetrics {
  clicks: number
  impressions: number
  /** 0..1. Format once, at the edge. */
  ctr: number
  position: number
  startDate: string
  endDate: string
}

/**
 * What the site is about, measured by grouping pages rather than by asking a model (ADR-0024).
 *
 * `pagesEmbedded` and `pagesCrawled` travel together because every share is a share of the
 * former, and a reader not told that will take the figure for the whole site.
 */
export interface TopicMap {
  pagesEmbedded: number
  pagesCrawled: number
  /** Which embedding model produced the vectors. The map is comparable only within one. */
  model?: string
  clusters: { name: string; share: number; pages: string[] }[]
}

/** The figures an audit recorded, beyond the scorecard. Absent on audits older than the column. */
export interface AuditMetrics {
  authority?: AuthorityMetrics
  search?: SearchMetrics
  topics?: TopicMap
}

/** One keyword idea, with the numbers the vendor reports for it. */
export interface KeywordIdea {
  keyword: string
  /** Average monthly searches. Null when the vendor reports none, which is not the same as zero. */
  searchVolume: number | null
  /**
   * Paid competition, 0 to 1. An **advertising** metric: how many advertisers bid on the term,
   * not how hard it is to rank for organically. The industry routinely renders this as "keyword
   * difficulty" and lets readers believe the second thing.
   */
  competition: number | null
  cpc: number | null
}

export interface KeywordIdeasResult {
  seed: string
  ideas: KeywordIdea[]
  /** Present only when nothing was measured, explaining why. */
  note?: string
}

/** One keyword a competitor ranks for and this site does not. */
export interface KeywordGapEntry extends KeywordIdea {
  /** Where the competitor ranks, 1 being the top. Null when the vendor omits it. */
  competitorPosition: number | null
  competitorUrl?: string
}

export interface KeywordGapResult {
  competitor: string
  keywords: KeywordGapEntry[]
  /**
   * How many rows Search Console removed because this site already appears for them.
   *
   * Null means the subtraction never ran (Google not connected, or no matching property), which
   * is a weaker answer than zero removed and has to read differently.
   */
  subtracted: number | null
  /** Present when something is missing, explaining what and why it matters. */
  note?: string
}

/** One question a site's customers actually ask, and where we learned it. */
export interface MinedQuestion {
  question: string
  /**
   * Which source produced it. They are not equivalent: `search-console` means this site is
   * already being shown for the question, `people-also-ask` means Google offers it alongside the
   * subject. Only the first is demand this site receives.
   */
  source: 'search-console' | 'people-also-ask'
  impressions?: number
  position?: number
  /** Other phrasings of the same question, grouped so one gap is one row. */
  variants: string[]
}

export interface MinedQuestions {
  questions: MinedQuestion[]
  /** Present when a source contributed nothing, saying which and why. */
  note?: string
}

/** One place that might publish this client, after its own page has been read. */
export interface ContributorCandidate {
  domain: string
  url: string
  title?: string
  snippet?: string
  /** `inviting` is an opportunity; `selling` was refused for selling placements. */
  verdict: 'inviting' | 'selling' | 'neither'
  /** The phrases that decided the verdict, so a human can disagree with the evidence. */
  matched: string[]
  relevance: number
}

export interface ContributorSearch {
  niche: string
  opportunities: ContributorCandidate[]
  /** Named rather than dropped: a filter nobody can see is a filter nobody can check. */
  refused: ContributorCandidate[]
  queriesRun: number
  note?: string
}

export interface KeywordGapQuery {
  siteId: string
  competitor: string
  country?: string
  language?: string
  limit?: number
}

export interface KeywordIdeasQuery {
  seed: string
  /** ISO country, e.g. 'ke'. Search volume is per-market, so this changes the answer. */
  country?: string
  language?: string
  limit?: number
}

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

    getFinding: async (id: string) =>
      (await request<{ finding: Finding & { rowId: string; auditId: string } }>(`/findings/${id}`))
        .finding,

    /**
     * Ask the agent to open a pull request that fixes a finding. Returns the queue status; the
     * worker detects the framework, generates the diff, opens the PR, and marks the finding
     * pr_open with its URL.
     */
    fixFinding: async (id: string) =>
      request<{ status: string }>(`/findings/${id}/fix`, { method: 'POST' }),

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
