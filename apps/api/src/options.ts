import type { KeywordProvider, OAuthConfig } from '@seo/connectors'
import type { Database } from '@seo/db'
import type { AuditJob, ConfirmVerifyJob, FixJob, VerifyFixJob, VerifyJob } from '@seo/queue'
import type { GitHubApp } from '@seo/vcs'

export interface AppOptions {
  db?: Database
  /** Origins allowed to call the API from a browser. The web app, and nothing else. */
  corsOrigins?: string[]
  /**
   * Puts an audit on the queue and nudges the worker. Injected rather than built here, so the
   * route knows nothing about pg-boss or GitHub, and a test can pass a spy. When absent,
   * `POST /audits` reports 503 rather than creating a queued row that nothing will ever run.
   */
  enqueue?: (job: AuditJob) => Promise<unknown>
  /**
   * Puts a verification-PR job on the queue and nudges the worker. Injected like `enqueue`.
   * Absent means `POST /sites/:id/verify` reports 503 rather than accepting work nothing runs.
   */
  enqueueVerify?: (job: VerifyJob) => Promise<unknown>
  /**
   * Puts a confirm-verification job on the queue when a verification PR is merged. Injected like
   * the others; absent means the webhook still acknowledges the merge but does not auto-confirm.
   */
  enqueueConfirmVerify?: (job: ConfirmVerifyJob) => Promise<unknown>
  /**
   * Puts a fix-PR job on the queue and nudges the worker. Injected like the others; absent means
   * `POST /findings/:id/fix` reports 503 rather than accepting work nothing will run.
   */
  enqueueFix?: (job: FixJob) => Promise<unknown>
  /**
   * Puts a verify-fix job on the queue when a fix PR is merged. Injected like the others; absent
   * means the webhook still marks the finding merged but does not auto-verify it.
   */
  enqueueVerifyFix?: (job: VerifyFixJob) => Promise<unknown>
  /**
   * A keyword-research provider for a tenant, already wrapped in that tenant's budget guard.
   *
   * A factory rather than a provider, because the guard is per-tenant (ADR-0017) and the tenant is
   * only known once a request has authenticated. Injected like everything else here so the route
   * can be tested with a fake and no spend, and so the app never reads credentials from the
   * environment itself. Absent, or returning undefined, means the route reports the axis as
   * unconfigured rather than erroring.
   *
   * It is handed this app's `Database` rather than opening its own. The spend ledger the guard
   * reads lives in the same Postgres as everything else, and a second pool on a free tier with a
   * hard connection ceiling is a real cost for no benefit.
   */
  keywords?: (tenantId: string, db: Database) => KeywordProvider | undefined
  /**
   * Google OAuth. Injected so the connection routes can be tested with a mocked token
   * endpoint, and so the app never reads process.env directly. Absent means the routes report
   * 503 rather than sending users to a half-configured consent screen.
   */
  google?: { config: OAuthConfig; fetch?: typeof globalThis.fetch }
  /**
   * The GitHub App (ADR-0002). Injected, like Google, so the connect and webhook routes can be
   * tested with a fake app and a known secret, and so the API never reads the App credentials
   * from process.env directly. Absent means those routes report 503 rather than pretend.
   */
  github?: {
    app: GitHubApp
    /** The App's URL slug, for building the install link `github.com/apps/<slug>`. */
    slug: string
    /** The secret GitHub signs each webhook with, so we can prove a delivery is genuine. */
    webhookSecret: string
  }
  /** Where the OAuth callback sends the browser when it is done. The web app's origin. */
  webUrl?: string
}

/**
 * What a route module is handed.
 *
 * Every route needs the database and the injected collaborators, and nothing else. Passing this
 * one object rather than threading four parameters means adding a collaborator is a change to
 * {@link AppOptions} and the one route that uses it, not to every signature in between.
 *
 * `webUrl` is resolved once in `buildApp` rather than per module, so two routes cannot disagree
 * about where the browser goes after an OAuth round trip.
 */
export interface RouteDeps {
  db: Database
  options: AppOptions
  /** Where an OAuth callback sends the browser when it is done. The web app's origin. */
  webUrl: string
}

/**
 * Every route is authenticated, and every route is scoped.
 *
 * `request.tenantId` is set by the onRequest hook below, or the request never reaches a
 * handler at all. So there is no way to write a handler that forgets to authenticate: it
 * would have nothing to pass to `withTenant`, and it would not compile.
 */
declare module 'fastify' {
  interface FastifyRequest {
    tenantId: string
    /** The exact bytes of a webhook body, kept so its HMAC signature can be verified. */
    rawBody?: string
  }
}
