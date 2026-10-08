import { brandFromTitle } from '@seo/core'
import { sites, withTenant, type Database } from '@seo/db'
import { eq } from 'drizzle-orm'

/**
 * The name each tracked competitor goes by, read from its own homepage.
 *
 * AI answers name businesses; they rarely give a web address. Since ADR-0040 the client is found
 * in such an answer by its brand name. A competitor was still looked for only by its address, so
 * on engines that give no sources the client was found far more readily than its rivals, and
 * share of voice leaned towards whoever was paying for the report. That is exactly the kind of
 * flattering number this product exists not to produce.
 *
 * So a competitor is given a name by the same rule the client's own name is captured by:
 * `brandFromTitle`, which accepts a name only when the homepage title plainly states it and
 * agrees with the domain, and otherwise returns nothing. No model, and no guess.
 *
 * The map holds three states on purpose:
 *
 *   - a name: read from the title, and used;
 *   - `null`: the homepage was read and its title does not state a name. Recorded, so it is not
 *     fetched again every day;
 *   - absent: not read yet, or the site did not answer. Tried again on the next run.
 */
export type CompetitorNames = Record<string, string | null>

/** What a homepage says about itself. `null` means it could not be read. */
export type ReadHomepage = (url: string) => Promise<{ title: string | null } | null>

/**
 * Work out the names for whichever competitors do not have an entry yet.
 *
 * Pure apart from the reader it is handed. Returns only the new entries, so a caller can tell
 * whether there is anything to store.
 */
export async function nameCompetitors(
  competitors: readonly string[],
  known: CompetitorNames,
  read: ReadHomepage,
): Promise<CompetitorNames> {
  const found: CompetitorNames = {}

  await Promise.all(
    competitors
      .filter((domain) => !(domain in known))
      .map(async (domain) => {
        const address = `https://${domain}`
        const page = await read(address).catch(() => null)
        // Did not answer. Leave it out, so tomorrow's run tries again.
        if (!page) return
        found[domain] = page.title ? brandFromTitle(page.title, address) : null
      }),
  )

  return found
}

/**
 * Fill in the missing names for a site's competitors and store them.
 *
 * Returns the full map as it now stands. Never throws: a name is a refinement of the
 * measurement, and a failure to fetch one must not cost the poll it was being fetched for.
 */
export async function captureCompetitorNames(
  db: Database,
  tenantId: string,
  siteId: string,
  competitors: readonly string[],
  known: CompetitorNames,
  read: ReadHomepage,
): Promise<CompetitorNames> {
  try {
    const found = await nameCompetitors(competitors, known, read)
    if (Object.keys(found).length === 0) return known

    const names = { ...known, ...found }
    await withTenant(db, tenantId, (tx) =>
      tx.update(sites).set({ competitorNames: names }).where(eq(sites.id, siteId)),
    )
    return names
  } catch (error) {
    console.error('competitor names: could not be captured, continuing without them:', error)
    return known
  }
}
