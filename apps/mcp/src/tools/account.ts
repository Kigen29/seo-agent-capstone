import type { ApiClient } from '@seo/api-client'
import { auditCadenceSchema } from '@seo/core'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { guard } from './result.js'

/**
 * The account tools: changes to the person's own settings in RankWright (ADR-0050).
 *
 * Everything here changes a row the account owns and can be changed straight back. None of it
 * touches a repository, opens a pull request, sends anything to anybody, or spends from the
 * monthly allowance beyond what an audit already does. That is the line between these and the
 * repository tools in `write.ts`, and the reason the two have separate switches: "let it tidy my
 * competitor list" and "let it open pull requests on my code" are different things to agree to.
 *
 * Two rules these tools hold themselves to, because an agent holds them and not a person:
 *
 *   - **Add and remove, never replace.** The API replaces a list whole, which suits a form that
 *     shows the list. An agent sent to add one competitor would send a list of one and delete
 *     the other nine. So each tool reads what is there, changes what was asked, and writes the
 *     result.
 *   - **Say what is now true.** Each answers with the state after the change, so the model
 *     reports what happened and not what it meant to do.
 */

const siteId = z.string().uuid().describe('From list_sites.')
const domain = z
  .string()
  .min(3)
  .max(253)
  .describe('A bare domain such as example.com. A full address is reduced to its domain.')

/** Changes a stored setting, reversibly. Not read-only, and nothing is destroyed. */
const CHANGE = { readOnlyHint: false, destructiveHint: false, openWorldHint: true } as const

const list = (items: readonly string[]) => (items.length > 0 ? items.join(', ') : 'none')

export function registerAccountTools(server: McpServer, api: ApiClient): void {
  server.registerTool(
    'run_audit',
    {
      title: 'Run an audit',
      description:
        'Queue a fresh crawl and audit for a site. Returns the new audit id immediately; the ' +
        'crawl runs on a worker, so poll audit_status until it reports finished, then read the ' +
        'result with get_audit. Changes nothing on the site itself.',
      inputSchema: { siteId },
      annotations: CHANGE,
    },
    async ({ siteId: id }) =>
      guard(async () => {
        const auditId = await api.startAudit(id)
        return (
          `Audit ${auditId} queued. Poll audit_status with this id until it reports finished, ` +
          'then call get_audit for the scorecard and the findings.'
        )
      }),
  )

  server.registerTool(
    'set_audit_schedule',
    {
      title: 'Set how often a site is audited',
      description:
        'Turn scheduled audits for a site on, off, or to another interval: off, weekly (every 7 ' +
        'days) or monthly (every 30). Takes effect the next time the worker wakes. An audit ' +
        'spends a little of the account’s monthly allowance on the topic map, which is why ' +
        'this is off by default: do not turn it on unless the person asked for it. Check the ' +
        'result with get_schedule.',
      inputSchema: { siteId, cadence: auditCadenceSchema },
      annotations: { ...CHANGE, idempotentHint: true },
    },
    async ({ siteId: id, cadence }) =>
      guard(async () => {
        const saved = await api.setAuditCadence(id, cadence)
        return saved === 'off'
          ? `Scheduled audits are off for ${id}. An audit now runs only when asked for.`
          : `Site ${id} is now audited ${saved === 'weekly' ? 'every 7 days' : 'every 30 days'}. ` +
              'Call get_schedule to see the day the next one is due.'
      }),
  )

  server.registerTool(
    'add_tracked_questions',
    {
      title: 'Track more questions for AI visibility',
      description:
        'Add questions that customers ask, to be put to AI answer engines once a day. Questions ' +
        'are only ever added: the ones already tracked have a history of checks that removing ' +
        'them would throw away. A question already tracked is skipped. Each question is a paid ' +
        'check every day, so add the ones the person agreed to and not a long list of guesses. ' +
        'A new question has no verdict until it has been checked on three different days.',
      inputSchema: {
        siteId,
        questions: z
          .array(z.string().trim().min(8).max(300))
          .min(1)
          .max(10)
          .describe('Whole questions as a customer would type them. Ten at most in one call.'),
      },
      annotations: CHANGE,
    },
    async ({ siteId: id, questions }) =>
      guard(async () => {
        const current = await api.getVisibility(id)
        const known = new Set(current.prompts.map((prompt) => prompt.trim().toLowerCase()))
        const added = [...new Set(questions.map((question) => question.trim()))].filter(
          (question) => !known.has(question.toLowerCase()),
        )
        if (added.length === 0) {
          return `Nothing added: all of those are already tracked. ${current.prompts.length} question(s) tracked.`
        }
        const saved = await api.setVisibility(id, {
          ...current,
          prompts: [...current.prompts, ...added],
        })
        return (
          `Added ${added.length} question(s); ${saved.prompts.length} now tracked. They are first ` +
          'checked on the next daily run, and need three days before any verdict.\n' +
          added.map((question) => `  + ${question}`).join('\n')
        )
      }),
  )

  server.registerTool(
    'change_competitors',
    {
      title: 'Add or remove competitors',
      description:
        'Add competitors to, or remove them from, the sites this one is compared with for share ' +
        'of voice and the weekly competitor watch. Give only the ones to add and the ones to ' +
        'remove; the rest are left as they are. At most ten competitors in all. Adding one ' +
        'changes the share-of-voice figure, since that only compares the site with its named ' +
        'competitors.',
      inputSchema: {
        siteId,
        add: z.array(domain).max(10).optional(),
        remove: z.array(domain).max(10).optional(),
      },
      annotations: CHANGE,
    },
    async ({ siteId: id, add = [], remove = [] }) =>
      guard(async () => {
        if (add.length === 0 && remove.length === 0) {
          return 'Nothing to do: give at least one domain to add or to remove.'
        }
        const bare = (value: string) =>
          value
            .trim()
            .toLowerCase()
            .replace(/^https?:\/\//, '')
            .replace(/^www\./, '')
            .replace(/\/.*$/, '')
        const current = (await api.getSiteProfile(id)).competitors
        const dropping = new Set(remove.map(bare))
        const next = [
          ...new Set([...current.filter((entry) => !dropping.has(entry)), ...add.map(bare)]),
        ]
        const saved = await api.saveCompetitors(id, next)
        return `Competitors are now: ${list(saved)}. (${saved.length} of 10.)`
      }),
  )

  server.registerTool(
    'name_competitor',
    {
      title: 'Say what a competitor is called',
      description:
        'Record the name a tracked competitor goes by, so it is recognised in AI answers that ' +
        'name it without linking to it. Use the name the business itself uses, exactly. Pass an ' +
        'empty name to clear it. The competitor must already be tracked.',
      inputSchema: {
        siteId,
        domain,
        name: z.string().trim().max(120).describe('The brand name as written, or empty to clear.'),
      },
      annotations: { ...CHANGE, idempotentHint: true },
    },
    async ({ siteId: id, domain: host, name }) =>
      guard(async () => {
        const names = await api.saveCompetitorName(id, host, name === '' ? null : name)
        const stored = names[host]
        return stored ? `${host} is now known as "${stored}".` : `${host} has no name recorded now.`
      }),
  )

  server.registerTool(
    'mark_not_us',
    {
      title: 'Say a site is, or is not, about this business',
      description:
        'Mark a site that mentions a business with the same name as NOT this business, so it is ' +
        'left out of brand mentions and outreach. Or put one back. Only the owner can know ' +
        'this, so do it when the person says so and not on a guess. The stored audit is never ' +
        'rewritten: the site is filtered when read, so putting it back restores it exactly.',
      inputSchema: {
        siteId,
        domain,
        notUs: z.boolean().describe('true to leave the site out, false to put it back.'),
      },
      annotations: { ...CHANGE, idempotentHint: true },
    },
    async ({ siteId: id, domain: host, notUs }) =>
      guard(async () => {
        const current = (await api.getSiteProfile(id)).mentionExclusions
        const next = notUs
          ? [...new Set([...current, host])]
          : current.filter((entry) => entry !== host)
        const saved = await api.saveMentionExclusions(id, next)
        return `Left out of brand mentions as not this business: ${list(saved)}.`
      }),
  )

  server.registerTool(
    'update_site_details',
    {
      title: 'Update what a site says about itself',
      description:
        'Set the brand name, what the business offers, or where its customers are. Give only ' +
        'the ones to change. The brand name must be written exactly as the business writes it: ' +
        'it is what brand mentions are searched for, and a wrong name finds a different ' +
        'business. Do not derive it from the domain.',
      inputSchema: {
        siteId,
        brand: z.string().trim().max(200).optional(),
        offering: z.string().trim().max(300).optional().describe('One sentence.'),
        market: z.string().trim().max(100).optional().describe('A country, region or city.'),
      },
      annotations: { ...CHANGE, idempotentHint: true },
    },
    async ({ siteId: id, ...changes }) =>
      guard(async () => {
        const given = Object.fromEntries(
          Object.entries(changes).filter(([, value]) => value !== undefined),
        ) as { brand?: string; offering?: string; market?: string }
        if (Object.keys(given).length === 0) {
          return 'Nothing to do: give a brand, an offering or a market to change.'
        }
        // The route replaces all three, so what was not given is sent back as it was.
        const current = await api.getSiteProfile(id)
        const saved = await api.saveSiteProfile(id, {
          brand: current.brand,
          offering: current.offering,
          market: current.market,
          ...given,
        })
        return (
          `Saved. Brand: ${saved.brand ?? 'not set'}. Offers: ${saved.offering ?? 'not set'}. ` +
          `Market: ${saved.market ?? 'not set'}.`
        )
      }),
  )

  server.registerTool(
    'add_site',
    {
      title: 'Add a site to the account',
      description:
        'Add a website to be audited. Returns its siteId. It is not audited until run_audit is ' +
        'called, and fixes cannot be opened for it until a repository is connected.',
      inputSchema: {
        url: z
          .string()
          .trim()
          .min(4)
          .max(2000)
          .describe('The site’s address, with or without https://.'),
      },
      annotations: CHANGE,
    },
    async ({ url }) =>
      guard(async () => {
        const site = await api.addSite(/^https?:\/\//i.test(url) ? url : `https://${url}`)
        return `Added ${site.url} as ${site.id}. Call run_audit with this id for its first audit.`
      }),
  )

  server.registerTool(
    'connect_repository',
    {
      title: 'Connect a repository to a site',
      description:
        'Say which GitHub repository holds a site’s code, so fixes can be opened there as pull ' +
        'requests. The repository must already be one the RankWright GitHub App was given ' +
        'access to, which only the person can do, in their browser. This grants nothing new: it ' +
        'records which already-granted repository belongs to which site.',
      inputSchema: {
        siteId,
        repository: z
          .string()
          .regex(/^[\w.-]+\/[\w.-]+$/)
          .describe('owner/name, as in the repository’s address on GitHub.'),
      },
      annotations: { ...CHANGE, idempotentHint: true },
    },
    async ({ siteId: id, repository }) =>
      guard(async () => {
        const saved = await api.setSiteRepo(id, repository)
        return `${saved.repoFullName} is now the repository for site ${id}.`
      }),
  )

  server.registerTool(
    'set_finding_status',
    {
      title: 'Dismiss a finding, or reopen one',
      description:
        'Mark an open finding as "wontfix" when the person has decided not to act on it, or set ' +
        'a dismissed one back to "open". A dismissed finding stays dismissed on later audits ' +
        'and is kept, with its evidence, so the decision can be revisited. This is the person’s ' +
        'decision to make: do not dismiss a finding to make a list shorter. A finding with a ' +
        'pull request open or merged cannot be dismissed.',
      inputSchema: {
        rowId: z.string().uuid().describe('The finding’s rowId, from list_findings.'),
        status: z.enum(['open', 'wontfix']),
      },
      annotations: { ...CHANGE, idempotentHint: true },
    },
    async ({ rowId, status }) =>
      guard(async () => {
        const saved = await api.setFindingStatus(rowId, status)
        return saved === 'wontfix'
          ? `Finding ${rowId} is dismissed as won’t fix. It stays dismissed on later audits until reopened.`
          : `Finding ${rowId} is open again.`
      }),
  )
}
