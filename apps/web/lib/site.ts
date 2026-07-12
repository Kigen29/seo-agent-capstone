/**
 * The canonical origin for this deployment.
 *
 * Vercel sets VERCEL_PROJECT_PRODUCTION_URL to the production domain on every
 * deployment, including previews, so robots.txt and the sitemap on a preview still
 * point at production and never invite a crawler to index a preview build.
 */
export const siteUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : 'http://localhost:3000'

/** Previews and local builds must never be indexed. Only production is indexable. */
export const isProduction = process.env.VERCEL_ENV === 'production'
