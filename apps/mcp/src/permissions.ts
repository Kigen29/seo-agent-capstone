/**
 * What this process may change, read from its environment (ADR-0050).
 *
 * Two switches, because there are two different things to agree to:
 *
 *   SEO_MCP_ALLOW_ACCOUNT_WRITES=1  settings in the account: questions, competitors, site
 *                                   details, the audit schedule, starting an audit, dismissing
 *                                   a finding. All reversible, none of it outside RankWright.
 *   SEO_MCP_ALLOW_REPO_WRITES=1     pull requests on the connected repository.
 *
 * `SEO_MCP_ALLOW_WRITES=1` is the switch there was before there were two, and still means both,
 * so nobody's existing setup loses a tool.
 *
 * Off means the tools are not registered at all, not registered and refusing. A model cannot
 * see a tool that was never listed, so it does not spend a turn calling one to be told no, and
 * does not tell the person the agent "refused" when nobody had enabled it.
 *
 * Only the exact value `1` turns a switch on. `true`, `yes` and `on` do not: a permission that
 * can be granted by a typo in either direction is not a permission.
 */
export interface WritePermissions {
  account: boolean
  repository: boolean
}

export function writePermissions(env: Record<string, string | undefined>): WritePermissions {
  const all = env.SEO_MCP_ALLOW_WRITES === '1'
  return {
    account: all || env.SEO_MCP_ALLOW_ACCOUNT_WRITES === '1',
    repository: all || env.SEO_MCP_ALLOW_REPO_WRITES === '1',
  }
}
