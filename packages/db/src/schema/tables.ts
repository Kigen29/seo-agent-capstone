import {
  apiTokens,
  authHandoffs,
  hostingConnections,
  oauthCredentials,
  userIdentities,
} from './access.js'
import { artefacts, audits, findings } from './audits.js'
import {
  competitorChanges,
  competitorSnapshots,
  visibilityChecks,
  visibilityPrompts,
} from './measurement.js'
import { spend } from './spend.js'
import { sites } from './tenancy.js'

/**
 * Every table, from one place.
 *
 * The declarations live in five files by what they are about, and this re-exports all of them,
 * so an import of `./schema/tables.js` is unchanged. The one thing declared here is the list of
 * tenant-scoped tables, because it is a statement about all of them at once.
 *
 *   tenancy      tenants, sites
 *   audits       audits, findings, fix attempts, crawl artefacts
 *   access       tokens, sign-ins, OAuth credentials, hosting connections
 *   measurement  AI answers, competitor readings, the free page check
 *   spend        spend and reservations
 */
export * from './tenancy.js'
export * from './audits.js'
export * from './access.js'
export * from './measurement.js'
export * from './spend.js'

/** Every table that carries a tenant_id, and therefore every table that needs RLS. */
export const TENANT_SCOPED = [
  hostingConnections,
  sites,
  audits,
  findings,
  artefacts,
  oauthCredentials,
  apiTokens,
  visibilityPrompts,
  visibilityChecks,
  spend,
  userIdentities,
  authHandoffs,
  competitorSnapshots,
  competitorChanges,
] as const
