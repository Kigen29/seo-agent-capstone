import type { Finding, Framework } from '@seo/core'
import {
  HEAD_FILES,
  headStrategyFor,
  injectHeadTags,
  type FixResult,
  type ReadRepoFile,
} from '@seo/fixers'
import { z } from 'zod'

/**
 * The one place an LLM writes to a client's repository, and it is kept on a short leash.
 *
 * ADR-0001 says a parser finds the issue and the LLM only writes the fix, and ADR-0005 says code
 * asks for a role, never a vendor. Both hold here: a deterministic rule (TECH-021) found the
 * missing description, this makes exactly one `smart` call for the text, validates it against a
 * schema before it can become a diff, and then a deterministic head injection places it. The LLM
 * never decides what is wrong, never sees the whole repo, and never emits anything the code parses
 * as free text. If the chain is unavailable the finding simply stays open; a broken PR is worse
 * than no PR.
 */

/** The smallest slice of the LLM client this needs. `@seo/llm`'s LlmClient satisfies it. */
export interface ContentLlm {
  object<T>(opts: {
    role: 'smart'
    tenantId: string
    schema: z.ZodType<T>
    system?: string
    prompt: string
  }): Promise<{ output: T }>
}

export interface ContentFixInput {
  finding: Finding
  framework: Framework
  read: ReadRepoFile
  /** The site's URL, for grounding the description when the page has no readable title. */
  siteUrl: string
}

export interface ContentFixDeps {
  llm: ContentLlm
  tenantId: string
}

/**
 * A meta description is short, factual, and easy to get wrong in a way that embarrasses the client
 * (invented awards, fake specifics), so the schema is strict and the prompt forbids invention. 70
 * to 160 characters is the window Google actually shows.
 */
const descriptionSchema = z.object({
  description: z.string().min(70).max(160),
})

/**
 * Generate a fix for a content finding the deterministic fixers cannot handle. Returns a FixResult
 * the worker opens as a PR, or null when there is nothing to safely do (the wrong rule, the LLM
 * unavailable, or no head to inject into).
 */
export async function generateContentFix(
  input: ContentFixInput,
  deps: ContentFixDeps,
): Promise<FixResult | null> {
  if (input.finding.ruleId !== 'TECH-021') return null

  const pageUrl = input.finding.affectedUrls[0] ?? input.siteUrl
  const title = await currentTitle(input.framework, input.read)

  let description: string
  try {
    const result = await deps.llm.object({
      role: 'smart',
      tenantId: deps.tenantId,
      schema: descriptionSchema,
      system:
        'You write meta descriptions for web pages. Return one description of 70 to 160 characters ' +
        'that plainly states what the page offers, in the third person. No clickbait, no all-caps, ' +
        'no emoji, and no invented specifics such as prices, awards, or ratings.',
      prompt:
        'Write a meta description for this page.\n' +
        `URL: ${pageUrl}\n` +
        (title ? `Page title: ${title}\n` : '') +
        'Base it only on the URL and the title. If you are unsure what the page offers, describe it ' +
        'in general terms rather than guessing at specifics.',
    })
    description = result.output.description
  } catch {
    // The chain is unavailable, or every target failed. Leave the finding open rather than open a
    // PR with no fix in it; the worker reports that no fix could be generated.
    return null
  }

  const change = await injectHeadTags(input.framework, input.read, [
    { tag: 'meta', attributes: { name: 'description', content: description } },
  ])
  if (!change) return null

  return {
    files: [change],
    expectedEffect:
      `The homepage now carries a meta description: "${description}". Google may show it as the ` +
      'search result snippet, which can lift clickthrough; it still rewrites snippets per query, so ' +
      'expect no ranking change from this alone.',
    rollback: 'Revert the merge commit; the meta description is removed and nothing else changes.',
  }
}

/** The page's current `<title>`, read from the framework's head file, for grounding the prompt. */
async function currentTitle(framework: Framework, read: ReadRepoFile): Promise<string | null> {
  for (const path of HEAD_FILES[headStrategyFor(framework)]) {
    const content = await read(path)
    if (content === null) continue
    const match = content.match(/<title>([^<]*)<\/title>/i)
    if (match) return match[1]!.trim()
  }
  return null
}
