import { createServer, request, type IncomingHttpHeaders } from 'node:http'
import { lookup } from 'node:dns/promises'
import { connect, isIP, type Socket } from 'node:net'
import { isPrivateAddress } from '@seo/core'
import type { EgressPolicy } from './egress.js'

/** Resolve once and connect to the inspected address, closing the DNS rebinding window. */
export async function pinnedAddress(hostname: string, policy: EgressPolicy = {}): Promise<string> {
  const host = hostname.replace(/^\[|\]$/g, '')
  const family = isIP(host)
  const answers = family
    ? [{ address: host, family }]
    : await (policy.resolve ?? ((name) => lookup(name, { all: true })))(host)
  if (
    !answers.length ||
    answers.some(
      (answer) =>
        !isIP(answer.address) ||
        (!policy.allowPrivateNetwork &&
          (policy.isBlocked ?? isPrivateAddress)(answer.address, answer.family)),
    )
  ) {
    throw new Error('Destination refused by crawler egress policy')
  }
  return answers[0]!.address
}

/** A crawl-scoped proxy shared by Chromium and Playwright's root/route fetches. */
export async function startEgressProxy(policy: EgressPolicy = {}) {
  const sockets = new Set<Socket>()
  const track = (socket: Socket) => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
    socket.setTimeout(30_000, () => socket.destroy())
    socket.on('error', () => socket.destroy())
    return socket
  }
  const server = createServer(async (incoming, response) => {
    try {
      const url = new URL(incoming.url ?? '')
      if (url.protocol !== 'http:' || url.username || url.password)
        throw new Error('Unsupported proxy target')
      const address = await pinnedAddress(url.hostname, policy)
      const headers: IncomingHttpHeaders = { ...incoming.headers, host: url.host }
      delete headers['proxy-authorization']
      delete headers['proxy-connection']
      const upstream = request(
        {
          hostname: address,
          port: url.port || 80,
          path: url.pathname + url.search,
          method: incoming.method,
          headers,
          agent: false,
        },
        (received) => {
          response.writeHead(received.statusCode ?? 502, received.headers)
          received.pipe(response)
        },
      )
      upstream.on('socket', track)
      upstream.on('error', () => {
        if (!response.headersSent) response.writeHead(502)
        response.end()
      })
      incoming.on('aborted', () => upstream.destroy())
      response.on('close', () => upstream.destroy())
      incoming.pipe(upstream)
    } catch {
      response.writeHead(403).end('Destination refused')
    }
  })
  server.on('connection', track)
  server.on('connect', async (incoming, client, head) => {
    try {
      const url = new URL(`https://${incoming.url}`)
      if (url.username || url.password || url.pathname !== '/')
        throw new Error('Invalid tunnel target')
      const address = await pinnedAddress(url.hostname, policy)
      if (client.destroyed) return
      const upstream = track(connect({ host: address, port: Number(url.port || 443) }))
      upstream.once('connect', () => {
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
        if (head.length) upstream.write(head)
        client.pipe(upstream).pipe(client)
      })
      client.on('close', () => upstream.destroy())
      upstream.on('close', () => client.destroy())
    } catch {
      client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
    }
  })
  // Live sockets are not needed to extract SEO evidence; refuse HTTP upgrades.
  server.on('upgrade', (_request, socket) => socket.destroy())
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Proxy did not bind')
  return {
    server: `http://127.0.0.1:${address.port}`,
    async close() {
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      )
    },
  }
}
