import type { FastifyInstance } from 'fastify'

/**
 * TEMPORARY. Shows a caller the forwarding headers their own request arrived with.
 *
 * Exists for one measurement: how many proxies Render puts in front of this service, and whether
 * a client-supplied X-Forwarded-For survives them. That decides TRUSTED_PROXY_HOPS, which cannot
 * be guessed safely (see AppOptions.trustProxyHops). Registered only while PROXY_DIAGNOSTIC=1, so
 * it is switched on in the Render dashboard for a few minutes and does not exist otherwise.
 *
 * It returns only what the caller's own request carried plus the address of the proxy that
 * connected to us: nothing about any other request, tenant or secret. It is removed once the
 * value is set.
 */
export function proxyDiagnosticRoutes(app: FastifyInstance): void {
  app.get('/diagnostic/forwarding', async (request, reply) => {
    const header = (name: string) => {
      const value = request.headers[name]
      return Array.isArray(value) ? value.join(', ') : (value ?? null)
    }
    reply.header('cache-control', 'no-store')
    return {
      socketAddress: request.socket.remoteAddress ?? null,
      resolvedIp: request.ip,
      xForwardedFor: header('x-forwarded-for'),
      cfConnectingIp: header('cf-connecting-ip'),
      trueClientIp: header('true-client-ip'),
      xRealIp: header('x-real-ip'),
    }
  })
}
