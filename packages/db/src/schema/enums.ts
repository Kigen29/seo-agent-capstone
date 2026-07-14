import {
  auditStatusSchema,
  axisSchema,
  effortSchema,
  findingStatusSchema,
  severitySchema,
} from '@seo/core'
import { pgEnum } from 'drizzle-orm/pg-core'

/**
 * The database enums are generated from the Zod schemas in `@seo/core`, not typed out
 * again here.
 *
 * Restating them by hand is an invitation to drift: someone adds a severity, the rule
 * engine happily emits it, and the insert fails at 3am with `invalid input value for enum`.
 * Deriving them means adding a value in one place is a migration, which is the correct
 * amount of friction, and forgetting the migration is impossible because there is nowhere
 * else to add it.
 */
const values = <T extends string>(options: readonly T[]) => options as unknown as [T, ...T[]]

export const severityEnum = pgEnum('severity', values(severitySchema.options))
export const axisEnum = pgEnum('axis', values(axisSchema.options))
export const effortEnum = pgEnum('effort', values(effortSchema.options))
export const findingStatusEnum = pgEnum('finding_status', values(findingStatusSchema.options))
export const auditStatusEnum = pgEnum('audit_status', values(auditStatusSchema.options))
