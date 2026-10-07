import process from 'node:process'
import { fileURLToPath, URL } from 'node:url'
const production = process.env.NODE_ENV === 'production'

/**
 * What a page of this app may load, and from where.
 *
 * Everything the app needs is served by the app: the scripts, the styles and the fonts are all
 * self-hosted, and the browser never calls the API (every request goes out from the server). So
 * the policy can name this origin for nearly everything, and an injected `<script src>` pointing
 * anywhere else is refused by the browser before it runs.
 *
 * Two allowances, each for a reason:
 *
 *   - `'unsafe-inline'` for scripts. Next writes its bootstrap inline and the theme is set by an
 *     inline script before first paint, so that a dark-mode reader never sees a white flash. The
 *     strict alternative is a nonce per request, which forces every page to render on demand,
 *     including the landing page, which is static on purpose. Inline is the weaker half of this
 *     policy and it is stated here so nobody mistakes it for an oversight; the stronger half,
 *     no script from any other origin, still holds.
 *   - `https:` for images, because a profile picture is served by whichever provider the person
 *     signed in with.
 *
 * In development the bundler evaluates code and talks over a websocket, so both are allowed
 * there and nowhere else.
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${production ? '' : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  `connect-src 'self'${production ? '' : ' ws:'}`,
  // Nothing may frame this app, which is what stops a sign-in or a "merge" click being
  // overlaid by another site.
  "frame-ancestors 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  // An injected <base> tag would otherwise repoint every relative link and form on the page.
  "base-uri 'self'",
].join('; ')

const securityHeaders = [
  { key: 'Content-Security-Policy', value: contentSecurityPolicy },
  // The same instruction as frame-ancestors, for browsers that only know the older header.
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // The origin and nothing more goes to other sites, so a path with an id in it is not passed on.
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // The app uses none of these, so no script running in it, ours or injected, may ask for them.
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()',
  },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  ...(production
    ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' }]
    : []),
]

/** @type {import('next').NextConfig} */
const nextConfig = {
  // "X-Powered-By: Next.js" tells a scanner which exploits to try first and tells nobody else
  // anything.
  poweredByHeader: false,

  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }]
  },

  ...(process.env.NEXT_STANDALONE === '1' ? { output: 'standalone' } : {}),
  outputFileTracingRoot: fileURLToPath(new URL('../../', import.meta.url)),
  // Root CI already runs ESLint across the whole workspace (pnpm lint). Running it a
  // second time inside next build only slows the deploy down and gives us two places
  // for a lint failure to hide.
  eslint: { ignoreDuringBuilds: true },

  /**
   * The old URLs, kept working.
   *
   * A finding used to live at `/dashboard/findings/:id` and an audit at `/dashboard/audits/:id`,
   * while the inbox listing them sat at the top level as `/findings`. The `dashboard` prefix was
   * doing no work: it named a page, not a section, and it split one feature across two levels of
   * the URL tree with two different auth gates.
   *
   * Permanent rather than temporary. The new paths are where these pages live now and there is no
   * plan to move them back, so anything holding an old link should learn the new one.
   */
  async redirects() {
    return [
      { source: '/dashboard/findings/:id', destination: '/findings/:id', permanent: true },
      { source: '/dashboard/audits/:id', destination: '/audits/:id', permanent: true },
    ]
  },
}

export default nextConfig
