import { defineConfig } from 'drizzle-kit'

/**
 * Points at the compiled schema, not the TypeScript source, so `db:generate` runs a build
 * first. drizzle-kit loads a TS schema through its own CJS loader, which does not honour
 * the `.js` import extensions that our NodeNext config requires, so it cannot resolve
 * `./enums.js` and dies. Reading the built output sidesteps its loader entirely.
 */
export default defineConfig({
  schema: './dist/schema/index.js',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
  strict: true,
  verbose: true,
})
