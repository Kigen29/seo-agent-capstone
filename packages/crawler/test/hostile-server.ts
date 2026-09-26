import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

export interface HostileSite {
  /** The public-facing origin the crawl is seeded with, on the 127.0.0.1 literal. */
  origin: string
  /** The same server addressed by a hostname, standing in for an internal host. */
  internal: string
  /** Every path that reached the server, including WebSocket upgrades. The witness. */
  requests: string[]
  close: () => Promise<void>
}

const LEAK = '/leak/'

/**
 * A site whose pages try to make the crawler's browser reach an internal host.
 *
 * Every way a page can make a browser send a request is here: an image, an iframe, a scripted
 * fetch, a WebSocket, a redirect from a page, and redirects from the sitemap and llms.txt. Each
 * points at `localhost`, which the tests' resolver reports as a private address. The server
 * listens on every loopback address, so a request that escapes the guard really does arrive and
 * is recorded under /leak/. The absence of those paths is the proof, not the crawler's own report.
 */
export async function startHostileSite(): Promise<HostileSite> {
  const requests: string[] = []
  let internal = ''

  const server: Server = createServer((req, res) => {
    const path = req.url ?? '/'
    requests.push(path)
    const origin = `http://${req.headers.host}`

    const send = (status: number, type: string, body: string) => {
      res.writeHead(status, { 'content-type': type })
      res.end(body)
    }
    const redirect = (location: string) => {
      res.writeHead(302, { location })
      res.end()
    }

    if (path.startsWith(LEAK)) return send(200, 'text/plain', 'internal secret')

    switch (path) {
      case '/robots.txt':
        return send(
          200,
          'text/plain',
          `User-agent: *\nAllow: /\n\nSitemap: ${origin}/sitemap.xml\n`,
        )
      case '/sitemap.xml':
        return redirect(`${internal}${LEAK}sitemap`)
      case '/llms.txt':
        return redirect(`${internal}${LEAK}llms`)
      case '/hop':
        return redirect(`${internal}${LEAK}redirect`)
      case '/':
        return send(
          200,
          'text/html; charset=utf-8',
          `<!doctype html><html><head><title>Hostile</title></head><body>
            <h1>Hostile</h1>
            <img src="${internal}${LEAK}img" alt="">
            <iframe src="${internal}${LEAK}iframe"></iframe>
            <a href="/hop">Hop</a>
            <script>
              fetch('${internal}${LEAK}fetch').catch(() => {})
              try { new WebSocket('${internal.replace('http', 'ws')}${LEAK}ws') } catch {}
            </script>
          </body></html>`,
        )
      default:
        return send(404, 'text/html', '<h1>404</h1>')
    }
  })

  server.on('upgrade', (req, socket) => {
    requests.push(req.url ?? '/')
    socket.destroy()
  })

  // No host: dual-stack, so `localhost` reaches this server whether it resolves to v4 or v6.
  await new Promise<void>((resolve) => server.listen(0, resolve))
  const { port } = server.address() as AddressInfo
  internal = `http://localhost:${port}`

  return {
    origin: `http://127.0.0.1:${port}`,
    internal,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

export const isLeak = (path: string) => path.startsWith(LEAK)
