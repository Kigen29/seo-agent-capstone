export { createDb, withoutTenant, withTenant } from './client.js'
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
  artefacts,
  audits,
  findings,
  oauthCredentials,
  sites,
  tenants,
  TENANT_SCOPED,
} from './schema/tables.js'
