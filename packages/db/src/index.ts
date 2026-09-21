export { asOwner, createDb, withoutTenant, withTenant } from './client.js'
export type { Database } from './client.js'

export {
  APP_ROLE,
  enableRls,
  rlsStatements,
  TENANT_SCOPED_TABLES,
  TENANT_SETTING,
  tenantPolicy,
} from './rls.js'

export * as schema from './schema/index.js'
export {
  apiTokens,
  artefacts,
  audits,
  authHandoffs,
  findings,
  oauthCredentials,
  publicChecks,
  sites,
  spend,
  tenants,
  userIdentities,
  visibilityChecks,
  visibilityPrompts,
  TENANT_SCOPED,
} from './schema/tables.js'
