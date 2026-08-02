/** @type {import('next').NextConfig} */
const nextConfig = {
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
