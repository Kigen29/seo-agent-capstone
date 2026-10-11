import type {
  ApiClient,
  CompetitorSuggestions,
  ContributorCandidate,
  ContributorSearch,
  PromptSuggestions,
} from '@seo/api-client'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { guard } from './result.js'

/**
 * The suggestion tools: the three places the dashboard offers a person a draft to choose from
 * (ADR-0050 named them as the next to add).
 *
 * Each one costs something, a model call or billed searches, and each one saves nothing. They
 * are registered whatever the permissions are, like the keyword tools, because they change
 * nothing: the spending is held by the account's allowance, which the API checks on every call.
 *
 * None is marked read-only, for the reason `keyword_ideas` is not. `readOnlyHint` is what a
 * client uses to decide what may run without asking, and a tool that spends is not one of those.
 *
 * What they return is a draft for a person. Every answer ends by naming the tool that would act
 * on it, and saying that the choice is the person's, because a model handed a list and a tool
 * that accepts a list will otherwise join the two without asking.
 */

const siteId = z.string().uuid().describe('From list_sites.')
const BILLED = { readOnlyHint: false, destructiveHint: false, openWorldHint: true } as const

export function formatCompetitorSuggestions(result: CompetitorSuggestions): string {
  const based = [
    result.basedOn.offering && 'what the site offers',
    result.basedOn.market && 'its market',
    result.basedOn.homepage && 'its homepage',
  ].filter(Boolean)

  const lines = [
    result.suggestions.length === 0
      ? 'No competitor could be suggested.'
      : `${result.suggestions.length} suggested competitor(s). Each was fetched and answered. None has been saved.`,
    based.length > 0
      ? `Drafted from ${based.join(', ')}.`
      : 'Drafted from the address alone: the site has no details filled in, so treat these loosely.',
  ]
  if (result.dropped > 0) {
    lines.push(`${result.dropped} more were named and left out because they did not answer.`)
  }

  for (const suggestion of result.suggestions) {
    lines.push(
      '',
      suggestion.domain,
      `  Its homepage is titled: ${suggestion.title ?? 'no title was found'}`,
      `  Why: ${suggestion.reason}`,
    )
  }

  lines.push(
    '',
    'These are drafted by a model, and the titles are there so the choice does not rest on its ' +
      'word. Show them to the person and add only the ones they pick, with change_competitors.',
  )
  return lines.join('\n')
}

export function formatQuestionSuggestions(result: PromptSuggestions): string {
  const lines = [
    result.suggestions.length === 0
      ? 'No question could be suggested.'
      : `${result.suggestions.length} suggested question(s). None is tracked yet.`,
  ]
  if (result.note) lines.push(result.note)

  for (const suggestion of result.suggestions) {
    lines.push('', suggestion.prompt, `  Why: ${suggestion.reason}`)
  }

  lines.push(
    '',
    'Each tracked question is a paid check every day, so show these to the person and track ' +
      'only the ones they pick, with add_tracked_questions.',
  )
  return lines.join('\n')
}

function candidate(entry: ContributorCandidate): string[] {
  return [
    '',
    `${entry.domain}${entry.title ? `: ${entry.title}` : ''}`,
    `  ${entry.url}`,
    `  Decided by these phrases on its page: ${entry.matched.length > 0 ? entry.matched.join('; ') : 'none recorded'}`,
  ]
}

export function formatPublications(result: ContributorSearch): string {
  const lines = [
    `Publications that might cover "${result.niche}": ${result.opportunities.length} inviting ` +
      `contributions, ${result.refused.length} refused. ${result.queriesRun} billed search(es) were run.`,
  ]
  if (result.note) lines.push(result.note)

  if (result.opportunities.length > 0) {
    lines.push('', 'Inviting contributions:')
    for (const entry of result.opportunities) lines.push(...candidate(entry))
  }

  if (result.refused.length > 0) {
    lines.push(
      '',
      'Refused, because they sell placements. Paying for a link or a post is against the search ' +
        'engines’ rules and this product will not help with it. They are listed so the filter ' +
        'can be checked, not as options:',
    )
    for (const entry of result.refused) lines.push(...candidate(entry))
  }

  lines.push(
    '',
    'This is a list to read, not to act on. The ask is coverage, not a link. An approach is ' +
      'drafted in the dashboard, under Authority, and a person sends it themselves: do not ' +
      'write to these publications or send anything on the person’s behalf.',
  )
  return lines.join('\n')
}

export function registerSuggestionTools(server: McpServer, api: ApiClient): void {
  server.registerTool(
    'suggest_competitors',
    {
      title: 'Suggest competitors',
      description:
        'Draft a list of competitors for a site from what it offers and where, each fetched to ' +
        'confirm it exists. BILLED: one model call against the account’s allowance, so ask ' +
        'once. Nothing is saved. The person chooses, and change_competitors adds their choice.',
      inputSchema: { siteId },
      annotations: BILLED,
    },
    async ({ siteId: id }) =>
      guard(async () => formatCompetitorSuggestions(await api.suggestCompetitors(id))),
  )

  server.registerTool(
    'suggest_questions',
    {
      title: 'Suggest questions to track',
      description:
        'Draft questions a customer might ask an AI assistant about what this site sells, for ' +
        'tracking whether the site is cited in the answers. BILLED: one model call, so ask ' +
        'once. Nothing is tracked. The person chooses, and add_tracked_questions tracks their ' +
        'choice, each of which is then a paid check every day.',
      inputSchema: { siteId },
      annotations: BILLED,
    },
    async ({ siteId: id }) =>
      guard(async () => formatQuestionSuggestions(await api.suggestPrompts(id))),
  )

  server.registerTool(
    'find_publications',
    {
      title: 'Find publications that might cover the site',
      description:
        'Search for publications that invite contributions in the site’s field, reading each ' +
        'page to decide. BILLED: several searches against a paid data source on every call, so ' +
        'ask once with a well-chosen niche. Returns the ones inviting contributions and, named ' +
        'separately, the ones refused for selling placements. It finds; it does not contact ' +
        'anybody, and nothing here sends email.',
      inputSchema: {
        siteId,
        niche: z
          .string()
          .min(3)
          .max(120)
          .describe('What the business does, in the words a publication would use.'),
        locale: z.string().max(60).optional().describe("A market word, e.g. 'Kenya'."),
        country: z.string().length(2).optional().describe("ISO country code, e.g. 'ke'."),
      },
      annotations: BILLED,
    },
    async ({ siteId: id, ...body }) =>
      guard(async () => formatPublications(await api.findContributors(id, body))),
  )
}
