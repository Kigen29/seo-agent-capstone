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
             <a href="/nofollowed" rel="nofollow">Nofollowed</a>
             <a href="https://example.com/external">External</a>`,
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

      default:
        html(page('Not found', '<h1>404</h1>'), 404)
    }
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo

  return {
    origin: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}
