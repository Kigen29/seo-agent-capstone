import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

/**
 * One hand-labelled claim: this rule should fire, on these pages.
 *
 * `why` is required and is not decoration. A label is an assertion about the world made by a
 * person, and in six months the only way to tell a considered label from a guess is whether
 * whoever wrote it could say what they saw. The issue this harness answers names its own failure
 * mode as "a precision figure computed against labels nobody checked"; an unexplained label is
 * how that starts.
 */
export const labelSchema = z.object({
  ruleId: z.string().regex(/^[A-Z]+-\d{3}$/, 'a rule id like TECH-007'),
  urls: z.array(z.string().url()).min(1, 'a label with no URL asserts nothing'),
  why: z.string().min(20, 'say what you actually saw on the page'),
})
export type Label = z.infer<typeof labelSchema>

export const goldenPageSchema = z.object({
  url: z.string().url(),
  /** The HTML as served. Stored verbatim so the case is reproducible without the network. */
  html: z.string(),
  status: z.number().int().default(200),
  headers: z.record(z.string()).default({}),
})
export type GoldenPage = z.infer<typeof goldenPageSchema>

/**
 * A labelled site.
 *
 * A site rather than a page, because the rule engine takes a whole-site context: orphan pages,
 * duplicate titles, sitemap coverage and click depth are all properties of a set of pages and
 * cannot be labelled one page at a time. A dataset of isolated pages could only ever grade the
 * subset of rules that happen to be page-local, which would quietly exclude the harder half.
 */
export const goldenCaseSchema = z.object({
  id: z.string().min(1),
  /** Where these pages came from, and when. Real sites change; a case is a fixed observation. */
  source: z.string().min(1),
  capturedAt: z.string().datetime(),
  seed: z.string().url(),
  robotsTxt: z.string().default(''),
  sitemapUrls: z.array(z.string().url()).default([]),
  llmsTxt: z.string().nullable().default(null),
  pages: z.array(goldenPageSchema).min(1),
  /**
   * Every rule the labeller checked and found *not* to apply.
   *
   * Without this a case is unfalsifiable in one direction: an unlabelled rule is indistinguishable
   * from a rule nobody looked at, so every false positive can be waved away as "we just did not
   * label that one". Naming the rules that were checked and cleared is what makes a false positive
   * on them mean something.
   */
  checkedAndClear: z.array(z.string().regex(/^[A-Z]+-\d{3}$/)).default([]),
  expected: z.array(labelSchema),
})
export type GoldenCase = z.infer<typeof goldenCaseSchema>

const here = dirname(fileURLToPath(import.meta.url))
export const DATASET_DIR = resolve(here, '../dataset')

/**
 * Load every case, failing loudly on the first malformed one.
 *
 * Not `.catch(() => skip)`. A dataset that silently drops a case it could not parse reports a
 * precision computed over fewer cases than the operator believes, which is exactly the kind of
 * quietly-wrong number this whole package exists to avoid producing.
 */
export function loadDataset(dir: string = DATASET_DIR): GoldenCase[] {
  const files = readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()

  return files.map((name) => {
    const raw: unknown = JSON.parse(readFileSync(join(dir, name), 'utf8'))
    const parsed = goldenCaseSchema.safeParse(raw)
    if (!parsed.success) {
      // The path as well as the message. "Required" on its own is useless when a case carries
      // forty labels and one of them is missing its `why`.
      const detail = parsed.error.issues
        .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('\n')
      throw new Error(`${name} is not a valid golden case:\n${detail}`)
    }
    return parsed.data
  })
}

/**
 * Complaints about a case that the schema cannot express.
 *
 * These are consistency checks between fields: a label pointing at a page the case does not
 * contain is not a type error, but it is a broken label, and it would be scored as a permanent
 * false negative that no engine change could ever fix.
 */
export function auditCase(golden: GoldenCase): string[] {
  const problems: string[] = []
  const urls = new Set(golden.pages.map((page) => page.url))

  for (const label of golden.expected) {
    for (const url of label.urls) {
      if (!urls.has(url)) {
        problems.push(
          `${label.ruleId} is labelled on ${url}, which is not one of this case's pages. ` +
            'It would count as a false negative forever.',
        )
      }
    }
  }

  const labelled = new Set(golden.expected.map((label) => label.ruleId))
  for (const ruleId of golden.checkedAndClear) {
    if (labelled.has(ruleId)) {
      problems.push(`${ruleId} is listed as checked-and-clear and also has a label.`)
    }
  }

  if (!golden.pages.some((page) => page.url === golden.seed)) {
    problems.push(`the seed ${golden.seed} is not among this case's pages`)
  }

  return problems
}
