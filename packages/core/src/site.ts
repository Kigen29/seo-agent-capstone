import { z } from 'zod'

/**
 * Detected from the client's repo, not guessed from the rendered page. Knowing
 * the framework is what turns "add a meta description" into an actual diff in
 * the right file, and it is the advantage no dashboard competitor has.
 */
export const frameworkSchema = z.enum([
  'next',
  'nuxt',
  'astro',
  'sveltekit',
  'remix',
  'gatsby',
  'react_spa',
  'wordpress',
  'hugo',
  'jekyll',
  'django',
  'rails',
  'unknown',
])

export type Framework = z.infer<typeof frameworkSchema>

export const siteSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  url: z.string().url(),

  /** The connected repository, if there is one. Without it we can only advise. */
  repoFullName: z.string().min(1).optional(),
  framework: frameworkSchema.default('unknown'),

  /** Search Console property, e.g. 'sc-domain:example.com'. */
  gscProperty: z.string().min(1).optional(),

  createdAt: z.string().datetime(),
})

export type Site = z.infer<typeof siteSchema>
