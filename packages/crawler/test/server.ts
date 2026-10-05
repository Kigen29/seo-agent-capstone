import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

export interface RequestLog {
  url: string
  userAgent: string
  at: number
}

export interface TestSite {
  origin: string
  requests: RequestLog[]
  /** A second server standing in for the rest of the web, which the site links out to. */
  external: string
  externalRequests: { url: string; method: string }[]
  close: () => Promise<void>
}

const page = (title: string, body: string) =>
  `<!doctype html><html><head><title>${title}</title></head><body>${body}</body></html>`

/**
 * A real HTTP server with the pathologies a crawler has to survive: a redirect chain, a
 * 404, a robots-disallowed path, a sitemap listing a page nothing links to, and a page
 * that is empty until JavaScript runs.
 *
 * Using a real server rather than mocking Playwright is the whole point. The story's
 * falsification condition is about how the crawler behaves against a live origin, and a
 * mocked browser cannot falsify that.
 */
export async function startTestSite(): Promise<TestSite> {
  const requests: RequestLog[] = []

  /**
   * "Somebody else's site": a different origin the test site links to. Local, so no test reaches
   * the real internet, and it answers the ways real sites answer a link checker.
   */
  const externalRequests: { url: string; method: string }[] = []
  const outside: Server = createServer((req, res) => {
    const path = req.url ?? '/'
    externalRequests.push({ url: path, method: req.method ?? 'GET' })
    const answer = (status: number, headers: Record<string, string> = {}) => {
      res.writeHead(status, { 'content-type': 'text/html', ...headers })
      res.end(req.method === 'HEAD' ? undefined : '<html><body>outside</body></html>')
    }
    switch (path) {
      case '/alive':
        return answer(200)
      case '/gone':
        return answer(404)
      case '/removed':
        return answer(410)
      // Serves browsers, refuses crawlers: the commonest reason a working link looks dead.
      case '/blocks-bots':
        return answer(403)
      // Answers HEAD wrongly, as many servers do, and serves the page to GET.
      case '/head-lies':
        return answer(req.method === 'HEAD' ? 404 : 200)
      case '/moved':
        return answer(301, { location: '/alive' })
      case '/moved-to-nowhere':
        return answer(302, { location: '/gone' })
      case '/flaky':
        return answer(503)
      default:
        return answer(404)
    }
  })
  await new Promise<void>((resolve) => outside.listen(0, '127.0.0.1', resolve))
  const external = `http://127.0.0.1:${(outside.address() as AddressInfo).port}`

  const server: Server = createServer((req, res) => {
    const path = req.url ?? '/'
    requests.push({
      url: path,
      userAgent: req.headers['user-agent'] ?? '',
      at: Date.now(),
    })

    const html = (body: string, status = 200) => {
      res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' })
      res.end(body)
    }

    const origin = `http://${req.headers.host}`

    switch (path) {
      case '/robots.txt':
        res.writeHead(200, { 'content-type': 'text/plain' })
        res.end(
          ['User-agent: *', 'Disallow: /admin', '', `Sitemap: ${origin}/sitemap.xml`, ''].join(
            '\n',
          ),
        )
        return

      case '/sitemap.xml':
        res.writeHead(200, { 'content-type': 'application/xml' })
        res.end(
          `<?xml version="1.0" encoding="UTF-8"?>
           <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
             <url><loc>${origin}/</loc></url>
             <url><loc>${origin}/orphan</loc></url>
           </urlset>`,
        )
        return

      case '/':
        html(
          page(
            'Home',
            `<h1>Home</h1>
             <a href="/a">Page A</a>
             <a href="/b">Page B</a>
             <a href="/admin">Admin</a>
             <a href="/redirect">Redirected</a>
             <a href="/missing">Missing</a>
             <a href="/csr">Client rendered</a>
             <a href="/csr-late">Client rendered from an API</a>
             <a href="/wide">A page with a fixed-width table</a>
             <a href="/nofollowed" rel="nofollow">Nofollowed</a>
             <a href="${external}/alive">External</a>
             <a href="${external}/gone">A page that was deleted</a>
             <a href="${external}/removed">A page that was removed on purpose</a>
             <a href="${external}/blocks-bots">A site that refuses crawlers</a>
             <a href="${external}/head-lies">A server that answers HEAD wrongly</a>
             <a href="${external}/moved">A page that moved</a>
             <a href="${external}/moved-to-nowhere">A redirect to a deleted page</a>
             <a href="${external}/flaky">A server having a bad day</a>
             <a href="${external}/alive#section">The same page, with a fragment</a>
             <a href="mailto:hello@example.com">Email</a>`,
          ),
        )
        return

      case '/a':
        html(page('Page A', '<h1>Page A</h1><p>Some content on page A.</p>'))
        return

      case '/b':
        html(page('Page B', '<h1>Page B</h1><a href="/a">Back to A</a>'))
        return

      case '/orphan':
        // In the sitemap, but nothing links to it.
        html(page('Orphan', '<h1>Orphan</h1><p>No link points here.</p>'))
        return

      case '/admin':
        // robots.txt disallows this. If it is ever requested, the crawler is broken.
        html(page('Admin', '<h1>Secret admin panel</h1>'))
        return

      case '/nofollowed':
        html(page('Nofollowed', '<h1>Should not be crawled</h1>'))
        return

      case '/redirect':
        res.writeHead(302, { location: '/redirect-2' })
        res.end()
        return

      case '/redirect-2':
        res.writeHead(302, { location: '/a' })
        res.end()
        return

      case '/missing':
        html(page('Not found', '<h1>404</h1>'), 404)
        return

      case '/csr':
        html(
          `<!doctype html><html><head><title>Loading</title></head><body>
             <div id="root"></div>
             <script>
               document.getElementById('root').innerHTML =
                 '<h1>Rendered by JavaScript</h1><p>' + 'word '.repeat(120) + '</p>'
             </script>
           </body></html>`,
        )
        return

      // A single-page app route whose content arrives from an API after the load event, which is
      // how most real ones work. Read at `load`, it is an empty shell.
      case '/csr-late':
        html(
          `<!doctype html><html><head><title>Loading</title></head><body>
             <div id="root"></div>
             <script>
               fetch('/api/content').then((r) => r.json()).then((data) => {
                 document.getElementById('root').innerHTML =
                   '<h1>' + data.title + '</h1><p>' + 'word '.repeat(120) + '</p>'
               })
             </script>
           </body></html>`,
        )
        return

      // Correct viewport tag, and still too wide for a phone: one fixed-width element is enough.
      case '/wide':
        html(
          `<!doctype html><html><head><title>Wide</title>
             <meta name="viewport" content="width=device-width, initial-scale=1"></head>
             <body><h1>Prices</h1><div style="width:1200px;height:40px;background:#ccc">a table</div>
           </body></html>`,
        )
        return

      case '/api/content':
        setTimeout(() => {
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ title: 'Loaded from the API' }))
        }, 600)
        return

      default:
        html(page('Not found', '<h1>404</h1>'), 404)
    }
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo

  return {
    origin: `http://127.0.0.1:${port}`,
    requests,
    external,
    externalRequests,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await new Promise<void>((resolve) => outside.close(() => resolve()))
    },
  }
}
