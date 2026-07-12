/** @type {import('next').NextConfig} */
const nextConfig = {
  // Root CI already runs ESLint across the whole workspace (pnpm lint). Running it a
  // second time inside next build only slows the deploy down and gives us two places
  // for a lint failure to hide.
  eslint: { ignoreDuringBuilds: true },
}

export default nextConfig
