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
  'vue_spa',
  'angular',
  'wordpress',
  'hugo',
  'jekyll',
  'django',
  'rails',
  'unknown',
])

export type Framework = z.infer<typeof frameworkSchema>

/**
 * Where a site is in the Search Console auto-verification lifecycle.
 *
 * `none` is the actionable state: nothing opened yet, so the dashboard offers the button.
 * `pr_open` means a verification PR is out for a human to merge; `merged` means it is merged and
 * we are waiting for Google to confirm once the site deploys; `verified` is done. Closing a PR
 * returns the site to `none`, so regenerating is one clean click.
 */
export const verificationStatusSchema = z.enum(['none', 'pr_open', 'merged', 'verified'])
export type VerificationStatus = z.infer<typeof verificationStatusSchema>

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
