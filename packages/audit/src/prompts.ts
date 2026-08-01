import { hostOf } from '@seo/connectors'
import { sites, visibilityPrompts, withTenant, type Database } from '@seo/db'
import { and, eq, notInArray } from 'drizzle-orm'

/**
 * The questions we ask the answer engines on a site's behalf, and the rivals we measure against.
 *
 * This is the one piece of configuration the AI-visibility axis cannot infer. Every other axis
 * reads something that already exists: the crawl, the field data, the repository. This one needs
 * somebody to say what their customers actually ask, because there is no way to derive "how much
 * does a Kenyan safari cost" from a website, and guessing it would produce a measurement of our
 * guess rather than of their business.
 */

/**
 * How many questions one site may track.
 *
 * A cost ceiling before it is a usability one. Each prompt is polled once a day, on every
 * configured engine, forever, so a prompt list is a standing subscription rather than a one-off
 * request, and twenty of them is already six hundred calls a month per engine. It is also about
 * as many questions as a business genuinely has: past twenty, prompts stop being the questions
 * customers ask and start being keyword permutations, which is the habit this product exists to
 * break.
 */
export const MAX_PROMPTS = 20

/** How many rivals share of voice is computed against. Beyond a handful the number stops reading. */
export const MAX_COMPETITORS = 10

/** Long enough for a real question, short enough that it is a question and not an essay. */
export const MAX_PROMPT_LENGTH = 300

export interface VisibilitySettings {
  prompts: string[]
  competitors: string[]
}

/**
 * Tidy a prompt list without changing what it means.
 *
 * Deduplication is case-insensitive because the same question in different capitals is the same
 * question, and storing both would split one measurement window into two half-samples, each too
 * thin to reach a verdict. The first spelling wins, so the list reads back the way it was typed.
 */
export function normalisePrompts(raw: readonly string[]): string[] {
  const seen = new Set<string>()
  const prompts: string[] = []

  for (const entry of raw) {
    const prompt = entry.trim().replace(/\s+/g, ' ')
    if (!prompt) continue

    const key = prompt.toLowerCase()
    if (seen.has(key)) continue

    seen.add(key)
    prompts.push(prompt)
  }

  return prompts
}

/**
 * Reduce competitors to bare hosts, and say which entries could not be read.
 *
 * Normalising here rather than at comparison time is what keeps the axis consistent: the citation
 * parser matches on host, so storing `https://Rival.com/about` would compare a URL against a host
 * and quietly never match. An entry that is not a host at all is returned as invalid rather than
 * dropped, because silently discarding a competitor would leave a user watching a share of voice
 * that omits the rival they most wanted to track, with nothing on screen to explain it.
 */
export function normaliseCompetitors(raw: readonly string[]): {
  competitors: string[]
  invalid: string[]
} {
  const seen = new Set<string>()
  const competitors: string[] = []
  const invalid: string[] = []

  for (const entry of raw) {
    const trimmed = entry.trim()
    if (!trimmed) continue

    const host = hostOf(trimmed)
    // A host with no dot is a word, not a domain. `hostOf` will happily parse "rivals" into the
    // hostname "rivals", which would then match nothing forever.
    if (!host || !host.includes('.')) {
      invalid.push(trimmed)
      continue
    }

    if (seen.has(host)) continue
    seen.add(host)
    competitors.push(host)
  }

  return { competitors, invalid }
}

/** What a site currently tracks. Empty prompts mean the axis is off, which is a valid state. */
export async function getVisibilitySettings(
  db: Database,
  tenantId: string,
  siteId: string,
): Promise<VisibilitySettings | null> {
  return withTenant(db, tenantId, async (tx) => {
    const [site] = await tx
      .select({ competitors: sites.competitors })
      .from(sites)
      .where(eq(sites.id, siteId))
      .limit(1)

    // Null, not empty settings: "this site is not yours or does not exist" and "this site tracks
    // nothing yet" are different answers, and only the caller can decide which is a 404.
    if (!site) return null

    const prompts = await tx
      .select({ prompt: visibilityPrompts.prompt })
      .from(visibilityPrompts)
      .where(eq(visibilityPrompts.siteId, siteId))
      .orderBy(visibilityPrompts.createdAt)

    return { prompts: prompts.map((row) => row.prompt), competitors: site.competitors }
  })
}

/**
 * Save a site's prompts and competitors, keeping the history of the ones that did not change.
 *
 * The important part is that this is a diff and not a replace. A prompt row owns its checks by
 * foreign key, so deleting and re-inserting the whole list on every save would cascade away every
 * poll ever taken, and a user who added one question on day four would silently reset the other
 * questions to zero days of history and wait three more days for a verdict they had already
 * earned. Rows whose text is unchanged are left exactly where they are.
 *
 * A prompt whose text is *edited* does lose its history, and that is correct rather than a
 * shortfall: a changed question is a different measurement, and carrying the old answers forward
 * would mean reporting a stability score for a question that was never asked that way.
 */
export async function saveVisibilitySettings(
  db: Database,
  tenantId: string,
  siteId: string,
  settings: VisibilitySettings,
): Promise<VisibilitySettings | null> {
  const saved = await withTenant(db, tenantId, async (tx) => {
    const [site] = await tx
      .select({ id: sites.id })
      .from(sites)
      .where(eq(sites.id, siteId))
      .limit(1)

    if (!site) return null

    const existing = await tx
      .select({ prompt: visibilityPrompts.prompt })
      .from(visibilityPrompts)
      .where(eq(visibilityPrompts.siteId, siteId))

    const wanted = new Set(settings.prompts)
    const held = new Set(existing.map((row) => row.prompt))

    // Drop what is gone. `notInArray` against an empty list is not valid SQL, so an empty prompt
    // list is a plain delete-all, which is also what the user asked for.
    if (settings.prompts.length === 0) {
      await tx.delete(visibilityPrompts).where(eq(visibilityPrompts.siteId, siteId))
    } else if (existing.some((row) => !wanted.has(row.prompt))) {
      await tx
        .delete(visibilityPrompts)
        .where(
          and(
            eq(visibilityPrompts.siteId, siteId),
            notInArray(visibilityPrompts.prompt, settings.prompts),
          ),
        )
    }

    const added = settings.prompts.filter((prompt) => !held.has(prompt))
    if (added.length > 0) {
      await tx
        .insert(visibilityPrompts)
        .values(added.map((prompt) => ({ tenantId, siteId, prompt })))
        // Two saves racing on the same new prompt would otherwise collide on the unique index.
        // The row existing is the outcome we wanted either way.
        .onConflictDoNothing()
    }

    await tx.update(sites).set({ competitors: settings.competitors }).where(eq(sites.id, siteId))

    return true
  })

  if (!saved) return null
  return getVisibilitySettings(db, tenantId, siteId)
}
