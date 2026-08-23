import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DATASET_DIR, goldenCaseSchema, type GoldenCase } from './dataset.js'

/**
 * Capture a live site into a golden case skeleton, with no labels.
 *
 * Labels are deliberately not generated. A dataset labelled by the engine it grades measures
 * nothing at all: every finding would match by construction and precision would be 1.0 forever.
 * This fetches the bytes and stops, and a person writes the `expected` entries by reading the
 * pages. That is the slow part and it is the part that carries all the value.
 *
 * The bytes are stored so a case is a fixed observation. Real sites change, and a harness that
 * refetched would report a number that moved for reasons having nothing to do with the code.
 */
export async function capture(
  id: string,
  seed: string,
  paths: string[],
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): Promise<GoldenCase> {
  const origin = new URL(seed).origin

  const robotsResponse = await fetchImpl(`${origin}/robots.txt`).catch(() => null)
  const robotsTxt = robotsResponse?.ok ? await robotsResponse.text() : ''

  const llmsResponse = await fetchImpl(`${origin}/llms.txt`).catch(() => null)
  const llmsTxt = llmsResponse?.ok ? await llmsResponse.text() : null

  const pages = []
  for (const path of paths) {
    const url = new URL(path, origin).toString()
    const response = await fetchImpl(url)
    pages.push({
      url,
      html: await response.text(),
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
    })
  }

  return goldenCaseSchema.parse({
    id,
    source: `captured from ${origin}`,
    capturedAt: new Date().toISOString(),
    seed,
    robotsTxt,
    llmsTxt,
    sitemapUrls: [],
    pages,
    checkedAndClear: [],
    expected: [],
  })
}

export function writeCase(golden: GoldenCase, dir: string = DATASET_DIR): string {
  const path = join(dir, `${golden.id}.json`)
  writeFileSync(path, `${JSON.stringify(golden, null, 2)}\n`, 'utf8')
  return path
}
