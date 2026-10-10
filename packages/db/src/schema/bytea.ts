import { customType } from 'drizzle-orm/pg-core'

/** Postgres `bytea`. Drizzle has no first-class type for it. */
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
})
