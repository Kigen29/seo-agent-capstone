import type { ApiClient } from '@seo/api-client'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { guard, text, type ToolResult } from './result.js'

/**
 * The write tools, and the reason this server is worth building.
 *
 * Every AI-SEO tool on the market can hand a model a list of problems. `fix_finding` is the one
 * that opens a pull request, and `verify_site` is the one that gets a Search Console property
 * verified by dropping the meta tag into the repo. Neither is possible without the repository,
 * which is why the products we are measured against do not offer them.
 *
 * These tools are registered only when the caller has asked for them, and they stop at a cap.
 * Nothing here can reach a default branch: every change lands on a `seo-agent/*` branch as a
 * pull request for a human to merge (CLAUDE.md rule 2). The gate below is not about that
 * danger, which is already handled. It is about the failure mode a tool call introduces that a
 * dashboard button does not, which is volume: a model that decides to fix everything can call
 * one tool forty times in a loop, and forty pull requests on a client's repository is a bad
 * afternoon for a human reviewer even when every one of them is correct.
 */

/** How many pull requests one server process may open before it refuses. */
export const DEFAULT_MAX_PRS = 3

export interface WriteOptions {
  /** The ceiling on pull requests opened by this process. */
  maxPrs?: number
}

/**
 * A counter shared by both PR-opening tools.
 *
 * Shared on purpose: the limit is on pull requests arriving at a human, and a reviewer does not
 * care whether the fourth one came from `fix_finding` or `verify_site`. Two separate budgets
 * would let a loop open twice the agreed number by alternating.
 *
 * Per-process rather than persisted. A user who restarts the server has made a deliberate
 * decision to carry on, and a cap that outlived the session would need storage, a reset policy,
 * and a way to clear it, which is a lot of machinery for a guard rail whose job is to stop a
 * runaway loop rather than to enforce a quota.
 */
function createPrBudget(max: number) {
  let opened = 0

  return {
    /** Returns a refusal to hand back, or undefined when there is room. */
    check(): ToolResult | undefined {
      if (opened < max) return undefined

      return text(
        `Refusing: this session has already opened ${opened} pull request(s), which is the ` +
          `limit (SEO_MCP_MAX_PRS, currently ${max}). This exists so a loop cannot open twenty ` +
          'pull requests on a repository. Review the ones already open and merge or close them, ' +
          'then restart the server, or raise SEO_MCP_MAX_PRS if you meant to open more.',
      )
    },
    spend(): void {
      opened += 1
    },
    get opened(): number {
      return opened
    },
  }
}

export function registerWriteTools(server: McpServer, api: ApiClient, options: WriteOptions = {}) {
  const budget = createPrBudget(options.maxPrs ?? DEFAULT_MAX_PRS)

  server.registerTool(
    'run_audit',
    {
      title: 'Run an audit',
      description:
        'Queue a fresh crawl and audit for a site. Returns the new audit id immediately; the ' +
        'crawl runs on a worker, so poll audit_status until it reports finished, then read the ' +
        'result with get_audit. Changes nothing on the site itself.',
      inputSchema: { siteId: z.string().uuid().describe('From list_sites.') },
      // Not read-only (it creates an audit and costs a crawl), but nothing is destroyed.
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ siteId }) =>
      guard(async () => {
        const auditId = await api.startAudit(siteId)
        return (
          `Audit ${auditId} queued. Poll audit_status with this id until it reports finished, ` +
          'then call get_audit for the scorecard and the findings.'
        )
      }),
  )

  server.registerTool(
    'fix_finding',
    {
      title: 'Open a pull request that fixes a finding',
      description:
        'Ask the agent to fix a finding in code. It detects the framework, generates the diff, ' +
        'and opens a pull request whose body carries the evidence, the expected effect, the ' +
        'falsification condition and a rollback note. Nothing reaches the default branch and a ' +
        'human still merges. Requires the site to have a repository connected, and the finding ' +
        'to be fixable and still open. Call get_finding first and read the evidence.',
      inputSchema: {
        rowId: z
          .string()
          .uuid()
          .describe("The finding's rowId (a UUID) from list_findings, not its rule key."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ rowId }) => {
      const refusal = budget.check()
      if (refusal) return refusal

      return guard(async () => {
        await api.fixFinding(rowId)
        budget.spend()
        return (
          `Fix queued for ${rowId}. The worker is generating the diff and opening the pull ` +
          'request; it appears on the finding shortly, and get_finding will then show its URL ' +
          `and a status of pr_open. ${budget.opened} of ${options.maxPrs ?? DEFAULT_MAX_PRS} ` +
          'pull requests used this session.'
        )
      })
    },
  )

  server.registerTool(
    'verify_site',
    {
      title: 'Verify a Search Console property by pull request',
      description:
        'Create the Search Console property for a site and open a pull request that adds its ' +
        'verification meta tag to the repository. Merging it completes verification. Requires ' +
        'both Google and a repository to be connected to the site.',
      inputSchema: { siteId: z.string().uuid().describe('From list_sites.') },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ siteId }) => {
      const refusal = budget.check()
      if (refusal) return refusal

      return guard(async () => {
        await api.verifySite(siteId)
        budget.spend()
        return (
          `Verification queued for ${siteId}. The agent is opening a pull request that adds the ` +
          'verification meta tag; merge it and the property verifies. ' +
          `${budget.opened} of ${options.maxPrs ?? DEFAULT_MAX_PRS} pull requests used this session.`
        )
      })
    },
  )
}
