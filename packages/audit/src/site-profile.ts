import { sites, withTenant, type Database } from '@seo/db'
import { eq } from 'drizzle-orm'

/**
 * What a site is, in its owner's words: its name, what it offers, and where its customers are.
 *
 * Kept apart from the AI-visibility settings on purpose. The brand and the competitors used to be
 * saved through the same call as the tracked questions, because the first screen that needed them
 * was the visibility page. But the authority axis reads the brand, the competitor watch reads the
 * competitors, and neither has anything to do with which questions are polled. A site's identity
 * belongs to the site.
 *
 * Each save here writes only its own columns, so naming a competitor can never delete a tracked
 * question and its poll history, which the combined save could do to a caller that sent a partial
 * body.
 */
export interface SiteProfile {
  url: string
  /** The name as the press would write it. Null until captured or typed. */
  brand: string | null
  /** What the business offers, in a sentence. Feeds the suggestions; never shown publicly. */
  offering: string | null
  /** The country or region its customers are in, as free text ("Kenya", "Nairobi", "East Africa"). */
  market: string | null
  competitors: string[]
  /** Sites the owner has said are not about them, left out of their brand mentions. */
  mentionExclusions: string[]
  /**
   * What each competitor is called, by domain (ADR-0041). A name, an explicit null when its
   * homepage states none, or absent when it has not been read yet.
   */
  competitorNames: Record<string, string | null>
}

export const MAX_BRAND = 200
export const MAX_OFFERING = 300
export const MAX_MARKET = 100

const tidy = (value: string | null | undefined, max: number): string | null => {
  const collapsed = (value ?? '').replace(/\s+/g, ' ').trim()
  return collapsed ? collapsed.slice(0, max) : null
}

/** Null when the site is not the tenant's, so a route can answer 404. */
export async function getSiteProfile(
  db: Database,
  tenantId: string,
  siteId: string,
): Promise<SiteProfile | null> {
  return withTenant(db, tenantId, async (tx) => {
    const [site] = await tx
      .select({
        url: sites.url,
        brand: sites.brand,
        offering: sites.offering,
        market: sites.market,
        competitors: sites.competitors,
        mentionExclusions: sites.mentionExclusions,
        competitorNames: sites.competitorNames,
      })
      .from(sites)
      .where(eq(sites.id, siteId))
      .limit(1)

    return site ?? null
  })
}

export async function saveSiteProfile(
  db: Database,
  tenantId: string,
  siteId: string,
  profile: { brand?: string | null; offering?: string | null; market?: string | null },
): Promise<SiteProfile | null> {
  return withTenant(db, tenantId, async (tx) => {
    const [saved] = await tx
      .update(sites)
      .set({
        brand: tidy(profile.brand, MAX_BRAND),
        offering: tidy(profile.offering, MAX_OFFERING),
        market: tidy(profile.market, MAX_MARKET),
      })
      .where(eq(sites.id, siteId))
      .returning({
        url: sites.url,
        brand: sites.brand,
        offering: sites.offering,
        market: sites.market,
        competitors: sites.competitors,
        mentionExclusions: sites.mentionExclusions,
        competitorNames: sites.competitorNames,
      })

    return saved ?? null
  })
}

/** Replace the tracked competitors, and nothing else. The caller normalises them first. */
export async function saveCompetitors(
  db: Database,
  tenantId: string,
  siteId: string,
  competitors: string[],
): Promise<string[] | null> {
  return withTenant(db, tenantId, async (tx) => {
    const [saved] = await tx
      .update(sites)
      .set({ competitors })
      .where(eq(sites.id, siteId))
      .returning({ competitors: sites.competitors })

    return saved?.competitors ?? null
  })
}

/**
 * Record a brand captured from the homepage, only where none is set.
 *
 * Never overwrites: a name a person typed is better evidence than one a parser read, and the
 * capture runs again whenever a site is added twice.
 */
export async function captureBrand(
  db: Database,
  tenantId: string,
  siteId: string,
  brand: string,
): Promise<void> {
  await withTenant(db, tenantId, (tx) =>
    tx
      .update(sites)
      .set({ brand: tidy(brand, MAX_BRAND) })
      .where(eq(sites.id, siteId)),
  )
}

/** Replace the list of sites that are not about this business. The caller normalises them. */
export async function saveMentionExclusions(
  db: Database,
  tenantId: string,
  siteId: string,
  domains: string[],
): Promise<string[] | null> {
  return withTenant(db, tenantId, async (tx) => {
    const [saved] = await tx
      .update(sites)
      .set({ mentionExclusions: domains })
      .where(eq(sites.id, siteId))
      .returning({ mentionExclusions: sites.mentionExclusions })

    return saved?.mentionExclusions ?? null
  })
}

export const MAX_COMPETITOR_NAME = 120

/**
 * Set, or clear, the name one tracked competitor goes by.
 *
 * For the competitor whose homepage title does not state its name, and for the one whose title
 * states it wrongly. A name a person typed is kept: the daily read only fills in competitors
 * with no entry, so it never overwrites this.
 *
 * Clearing a name removes the entry altogether, and does not store "no name". That hands the
 * competitor back to the daily read, which is what somebody clearing a field most likely wants.
 *
 * Only a tracked competitor can be named. Returns null when the site is not the tenant's, and
 * the names unchanged when the domain is not one of its competitors.
 */
export async function saveCompetitorName(
  db: Database,
  tenantId: string,
  siteId: string,
  domain: string,
  name: string | null,
): Promise<Record<string, string | null> | null> {
  return withTenant(db, tenantId, async (tx) => {
    const [site] = await tx
      .select({ competitors: sites.competitors, competitorNames: sites.competitorNames })
      .from(sites)
      .where(eq(sites.id, siteId))
      .limit(1)
    if (!site) return null
    if (!site.competitors.includes(domain)) return site.competitorNames

    const names = { ...site.competitorNames }
    const tidied = tidy(name, MAX_COMPETITOR_NAME)
    if (tidied) names[domain] = tidied
    else delete names[domain]

    await tx.update(sites).set({ competitorNames: names }).where(eq(sites.id, siteId))
    return names
  })
}
