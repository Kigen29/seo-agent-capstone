import { z } from 'zod'

/**
 * Names for clusters that already exist.
 *
 * The one genuinely subjective step in the topic map, and deliberately the one with no
 * consequence. ADR-0024 draws the line precisely: the model may label a group, and nothing
 * downstream may depend on the label. Membership was decided by cosine similarity over embeddings,
 * the findings are computed from membership and from the link graph, and this call only supplies
 * the words a human reads on the treemap.
 *
 * That is why it takes page titles and returns strings, and why it cannot fail the measurement.
 * A model that is unavailable, over budget or talking nonsense costs the map its names, not its
 * clusters: the caller falls back to the most common words in each cluster and says so.
 *
 * One call per audit, over all the clusters at once, on the `fast` role. Not one call per cluster
 * and certainly not one per page: cost discipline in CLAUDE.md is explicit that the model writes
 * the explanation, never the measurement.
 */

/** The smallest slice of the LLM client this needs. `@seo/llm`'s LlmClient satisfies it. */
export interface TopicNamingLlm {
  object<T>(opts: {
    role: 'fast'
    tenantId: string
    schema: z.ZodType<T>
    system?: string
    prompt: string
  }): Promise<{ output: T }>
}

export interface ClusterToName {
  /** A stable handle the model echoes back, so names cannot be silently reordered. */
  id: number
  /** A sample of the cluster's page titles. Enough to recognise a subject, not the whole list. */
  titles: string[]
}

const namesSchema = z.object({
  clusters: z.array(
    z.object({
      id: z.number().int(),
      /** Two or three words. A sentence is a summary, and the treemap has no room for one. */
      name: z.string().min(1).max(40),
    }),
  ),
})

export const TOPIC_NAMING_SYSTEM =
  'You name groups of web pages that have already been grouped for you. You are not deciding ' +
  'what belongs together: the grouping is fixed and is not yours to question, even when a page ' +
  'looks out of place. Give each group the shortest noun phrase a person browsing the site would ' +
  'recognise, two or three words, in the language of the titles. No marketing adjectives, no ' +
  'invented categories, nothing that is not evidenced by the titles you were shown. Echo each ' +
  'group id back exactly as given.'

/** How many titles per cluster the model sees. Enough to recognise a subject, cheaply. */
const TITLE_SAMPLE = 8

export function topicNamingPrompt(clusters: readonly ClusterToName[]): string {
  const blocks = clusters.map((cluster) => {
    const titles = cluster.titles
      .slice(0, TITLE_SAMPLE)
      .map((title) => `  - ${title}`)
      .join('\n')
    return `Group ${cluster.id} (${cluster.titles.length} pages):\n${titles}`
  })

  return `Name each group of pages.\n\n${blocks.join('\n\n')}`
}

/**
 * Ask a model to name each cluster. Returns names by cluster id, and an empty map on any failure.
 *
 * Failure is not exceptional here and is not propagated: the map without names is still a map,
 * and losing the measurement because a naming call timed out would be the tail wagging the dog.
 */
export async function nameTopics(
  llm: TopicNamingLlm,
  tenantId: string,
  clusters: readonly ClusterToName[],
): Promise<Map<number, string>> {
  if (clusters.length === 0) return new Map()

  try {
    const { output } = await llm.object({
      role: 'fast',
      tenantId,
      schema: namesSchema,
      system: TOPIC_NAMING_SYSTEM,
      prompt: topicNamingPrompt(clusters),
    })

    const known = new Set(clusters.map((cluster) => cluster.id))
    const names = new Map<number, string>()

    for (const entry of output.clusters) {
      // An id we did not ask about is the model inventing a group. Dropped rather than trusted:
      // the clusters are the measurement and a name cannot create one.
      if (!known.has(entry.id)) continue
      const name = entry.name.trim()
      if (name) names.set(entry.id, name)
    }

    return names
  } catch {
    return new Map()
  }
}
