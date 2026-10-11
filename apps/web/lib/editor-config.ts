/**
 * What a person pastes into their editor to connect it to this account over MCP.
 *
 * Pure, so the exact text can be tested: a config with one wrong character is a support request,
 * and the person reading it cannot tell which character is at fault.
 *
 * Two ways to run the server, and the page shows whichever is true for this deployment. From
 * npm when the package has been published, which is one line and no checkout. Otherwise from a
 * clone of the repository. Offering an `npx` command for a package that is not on the registry
 * would be a config that fails with an error about npm, on the first thing a new user tries.
 */

/** Shown in place of the token until one has been made, so the config can be read first. */
export const TOKEN_PLACEHOLDER = 'seo_paste_your_token_here'

/** Where the built server is, inside a clone. The person replaces the part before `apps`. */
export const CLONE_SERVER_PATH = '/path/to/seo-agent-capstone/apps/mcp/dist/server.js'

export const REPOSITORY_URL = 'https://github.com/Kigen29/seo-agent-capstone'

export interface EditorConfigInput {
  /** The API's public address. */
  apiUrl: string
  token: string
  /** The npm package to run, or undefined when the server is run from a clone. */
  packageName?: string | undefined
  /**
   * Offer the tools that change things: start an audit, open a pull request. Off unless the
   * person asks, because the one pasting a config has usually only decided to look.
   */
  allowWrites?: boolean | undefined
}

/** The two values the server needs, and a third only when writes were asked for. */
function environment(input: EditorConfigInput): Record<string, string> {
  return {
    SEO_API_URL: input.apiUrl,
    SEO_API_TOKEN: input.token,
    ...(input.allowWrites ? { SEO_MCP_ALLOW_WRITES: '1' } : {}),
  }
}

/**
 * The JSON most editors read: Cursor (`.cursor/mcp.json`), VS Code, Claude Desktop, Windsurf.
 *
 * `npx -y` here, where it is safe: this is a file, and no shell reads it.
 */
export function editorJson(input: EditorConfigInput): string {
  return JSON.stringify(
    {
      mcpServers: {
        rankwright: {
          ...(input.packageName
            ? { command: 'npx', args: ['-y', input.packageName] }
            : { command: 'node', args: [CLONE_SERVER_PATH] }),
          env: environment(input),
        },
      },
    },
    null,
    2,
  )
}

/**
 * One command for Claude Code, which registers the server without a file being edited.
 *
 * Every choice in it is about being pasted into a shell we do not get to pick. Two earlier
 * versions failed on Windows, each found by somebody running it:
 *
 *   - It was four lines joined with a backslash. That continues a line in a Unix shell and does
 *     nothing in PowerShell or the command prompt, where the first line ran alone.
 *   - It then ended `-- npx -y <package>`. PowerShell consumes a bare `--` before the program
 *     sees it, so `-y` was read as an option to `claude` and refused as unknown.
 *
 * So: one line, no `--`, and nothing after the server's name that starts with a dash. That
 * needs two adjustments, and both are deliberate:
 *
 *   - `--env` takes any number of values, so the options are written first and closed by
 *     `--scope user`, and the name and the command come after it.
 *   - `npx` is told not to ask before installing through `npm_config_yes`, which is the same
 *     setting as its `-y` flag, given as an environment value where a flag cannot go.
 *
 * `--scope user` is also the right scope for its own sake: the server belongs to the person's
 * account, and without it Claude Code registers it only for the folder the command was run in.
 */
export function claudeCodeCommand(input: EditorConfigInput): string {
  const values = {
    ...environment(input),
    ...(input.packageName ? { npm_config_yes: 'true' } : {}),
  }
  return [
    'claude mcp add',
    ...Object.entries(values).map(([key, value]) => `--env ${key}=${value}`),
    '--scope user',
    'rankwright',
    input.packageName ? `npx ${input.packageName}` : `node ${CLONE_SERVER_PATH}`,
  ].join(' ')
}

/** The steps that come first when the server is run from a clone. */
export const CLONE_STEPS = [
  `git clone ${REPOSITORY_URL}`,
  'cd seo-agent-capstone',
  'pnpm install',
  'pnpm build',
].join('\n')
