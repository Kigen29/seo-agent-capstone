import {
  newNonce,
  readCookie,
  safeNext,
  signSigninState,
  verifySigninState,
  SIGNIN_NONCE_COOKIE,
} from '@seo/connectors'
import { asOwner, userIdentities, type Database } from '@seo/db'
import { eq } from 'drizzle-orm'
import type { FastifyInstance, FastifyReply } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { bearerToken } from '../auth.js'
import {
  createHandoff,
  redeemHandoff,
  resolveIdentity,
  revokeToken,
  sweepHandoffs,
} from '../identity.js'
import type { RouteDeps } from '../options.js'

/**
 * Signing in with GitHub or Google.
 *
 * The important thing about this file is how little it changes. A session is still an API token,
 * still hashed in `api_tokens`, still presented as a bearer credential, still resolved to a
 * tenant before any handler runs. These routes are a new way to *get* one of those; they are not
 * a second kind of session. Nothing downstream, not row-level security, not `withTenant`, not the
 * MCP server, not a single existing token, can tell the difference, and that is the point.
 *
 * Three routes, and all three are unauthenticated because they have to be. Somebody signing in
 * has no session yet, which is the entire situation.
 *
 * What makes that safe is different for each. The start route is harmless: it sets a nonce and
 * redirects. The callback is safe because the state is signed by us and its nonce must match a
 * cookie only our origin could have set, so a code obtained by an attacker for their own account
 * cannot be walked through a victim's browser. The exchange is safe because a handoff code is
 * single use, expires in two minutes, and is stored only as a hash.
 */
export function signinRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const { db, options, webUrl } = deps

  const web = webUrl.replace(/\/$/, '')
  const backToLogin = (reason: string) => `${web}/login?error=${reason}`

  /**
   * Which providers are actually configured.
   *
   * Unauthenticated, and it gives away nothing: the answer is which buttons a login page should
   * draw, which anyone can discover by looking at the page. It exists so the page cannot offer a
   * button that leads to a 503, which is a worse first impression than one fewer option.
   */
  app.get('/auth/providers', async () => ({
    providers: Object.keys(options.identityProviders ?? {}).sort(),
  }))

  /**
   * Start: set the nonce, send the browser to the provider.
   *
   * The nonce cookie is what binds the round trip to *this* browser. `SameSite=Lax` rather than
   * `Strict` is required, not a compromise: the callback arrives as a top-level navigation from
   * github.com or accounts.google.com, and Strict would withhold the cookie on exactly that
   * request, breaking every sign-in.
   */
  app.withTypeProvider<ZodTypeProvider>().get(
    '/auth/signin/:provider',
    {
      schema: {
        params: z.object({ provider: z.string().max(20) }),
        querystring: z.object({ next: z.string().max(200).optional() }),
      },
    },
    async (request, reply) => {
      const provider = options.identityProviders?.[request.params.provider]
      if (!provider) return reply.redirect(backToLogin('provider_unavailable'))

      const nonce = newNonce()
      const next = safeNext(request.query.next)

      setNonceCookie(reply, nonce)

      return reply.redirect(
        provider.authUrl(
          signSigninState({ provider: provider.name, nonce, ...(next ? { next } : {}) }),
        ),
      )
    },
  )

  /**
   * Callback: prove the state, trade the code for an identity, hand back a handoff code.
   *
   * Note the ordering. The state and the nonce are checked before the code is redeemed, so a
   * forged callback never reaches the provider's token endpoint at all.
   *
   * The provider is read from inside the *signed* payload, never from the path, so a caller
   * cannot present a state minted for one provider and have the code redeemed against another.
   */
  app.withTypeProvider<ZodTypeProvider>().get(
    '/auth/signin/callback',
    {
      schema: {
        querystring: z.object({
          code: z.string().optional(),
          state: z.string().optional(),
          error: z.string().optional(),
        }),
      },
    },
    async (request, reply) => {
      const { code, state, error } = request.query

      clearNonceCookie(reply)

      // Declining consent is a choice, not a failure, and it gets a plain message.
      if (error || !code || !state) return reply.redirect(backToLogin('declined'))

      const verified = verifySigninState(state)
      if (!verified) return reply.redirect(backToLogin('invalid_state'))

      const presented = readCookie(request.headers.cookie, SIGNIN_NONCE_COOKIE)
      if (!presented || presented !== verified.nonce) {
        return reply.redirect(backToLogin('invalid_state'))
      }

      const provider = options.identityProviders?.[verified.provider]
      if (!provider) return reply.redirect(backToLogin('provider_unavailable'))

      try {
        const identity = await provider.identify(code)
        const { tenantId } = await resolveIdentity(db, identity, options.newTenantBudgetMicros)
        const handoff = await createHandoff(db, tenantId)

        const params = new URLSearchParams({ code: handoff })
        if (verified.next) params.set('next', verified.next)

        return reply.redirect(`${web}/auth/callback?${params.toString()}`)
      } catch (err) {
        // Never put a provider's error text in a redirect: it lands in browser history and logs,
        // and it occasionally carries a token fragment. Log it here, send back a generic reason.
        console.error('sign-in callback failed', err)
        return reply.redirect(backToLogin('failed'))
      }
    },
  )

  /**
   * Exchange: the web app's server trades the handoff code for the session token.
   *
   * A POST from the web app's server, never a GET the browser follows, so the token is in a
   * response body rather than anywhere a URL can be written down. This is the one place a
   * session token exists in plaintext, and it exists there for exactly as long as it takes to be
   * put in an httpOnly cookie.
   */
  app
    .withTypeProvider<ZodTypeProvider>()
    .post(
      '/auth/exchange',
      { schema: { body: z.object({ code: z.string().min(1).max(200) }) } },
      async (request, reply) => {
        const token = await redeemHandoff(db, request.body.code)

        // Unknown, already redeemed, or expired all answer the same. Telling them apart would be
        // an oracle for guessing codes, and the caller can do nothing different with the detail.
        if (!token) {
          return reply
            .status(400)
            .send({ error: 'Bad Request', message: 'That sign-in link is no longer valid.' })
        }

        void sweepHandoffs(db)

        return { token }
      },
    )
}

/**
 * Who is signed in, for the dashboard to show.
 *
 * Authenticated, and registered with the protected routes rather than beside the three above. It
 * answers from the identity table, so a session minted by `mint-token` for the CLI honestly
 * reports no identity rather than inventing one.
 */
export function identityRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const { db } = deps

  app.get('/auth/me', async (request) => {
    const [row] = await withTenantIdentity(db, request.tenantId)
    return { identity: row ?? null }
  })

  /**
   * Sign out, meaning the credential stops working, not merely that the browser forgets it.
   *
   * Clearing the cookie alone leaves the token alive on the server for another thirty days, so
   * anyone who captured it beforehand keeps a working session after the user believed they had
   * signed out. Deleting the row is the difference between those two.
   *
   * Exactly the presented token, never every token for the tenant: signing out of this browser
   * must not revoke the CLI token somebody is using elsewhere, or another browser they are still
   * signed in on.
   */
  app.post('/auth/signout', async (request, reply) => {
    const token = bearerToken(request.headers.authorization)
    if (token) await revokeToken(db, token)

    return reply.status(204).send()
  })
}

function withTenantIdentity(db: Database, tenantId: string) {
  return asOwner(db, (tx) =>
    tx
      .select({
        provider: userIdentities.provider,
        email: userIdentities.email,
        name: userIdentities.name,
        avatarUrl: userIdentities.avatarUrl,
      })
      .from(userIdentities)
      .where(eq(userIdentities.tenantId, tenantId))
      .limit(1),
  )
}

/** Ten minutes, matching the signed state's own lifetime. The consent screen is quick. */
const NONCE_MAX_AGE_SECONDS = 600

function setNonceCookie(reply: FastifyReply, nonce: string): void {
  reply.header(
    'set-cookie',
    `${SIGNIN_NONCE_COOKIE}=${encodeURIComponent(nonce)}; Path=/auth; Max-Age=${NONCE_MAX_AGE_SECONDS}; HttpOnly; SameSite=Lax${
      process.env.NODE_ENV === 'production' ? '; Secure' : ''
    }`,
  )
}

function clearNonceCookie(reply: FastifyReply): void {
  reply.header(
    'set-cookie',
    `${SIGNIN_NONCE_COOKIE}=; Path=/auth; Max-Age=0; HttpOnly; SameSite=Lax${
      process.env.NODE_ENV === 'production' ? '; Secure' : ''
    }`,
  )
}
