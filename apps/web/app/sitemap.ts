import type { MetadataRoute } from 'next'
import { siteUrl } from '@/lib/site'

/**
 * Every page we want found, and no other: the homepage and the free check.
 *
 * No `lastModified`. It used to be `new Date()`, which claims the page changed at the moment
 * the sitemap was read, every time it is read. A date that is always now carries no
 * information, and search engines stop trusting a sitemap whose dates are not true. Leaving it
 * out is the honest value until there is a real one to give. `priority` and `changeFrequency`
 * are left out for a similar reason: Google documents that it ignores both.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: siteUrl }, { url: `${siteUrl}/check` }]
}
