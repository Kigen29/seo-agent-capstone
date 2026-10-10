/**
 * What a person pastes into their editor to connect it to this account over MCP.
 *
 * Pure, so the exact text can be tested: a config with one wrong quote is a support request,
 * and the person reading it cannot tell which character is at fault.
 *
 * Two ways to run the server, and the page shows whichever is true for this deployment. From
 * npm when the package has been published, which is one line and no checkout. Otherwise from a
 * clone of the repository, which works today. Offering an `npx` command for a package that is
 * not on the registry would be a config that fails with an error about npm, on the first thing
 * a new user tries.
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
}

function launch(input: EditorConfigInput): { command: string; args: string[] } {
  return input.packageName
    ? { command: 'npx', args: ['-y', input.packageName] }
    : { command: 'node', args: [CLONE_SERVER_PATH] }
}

/**
 * The JSON most editors read: Cursor (`.cursor/mcp.json`), VS Code, Claude Desktop, Windsurf.
 *
 * Writes are not switched on here. They are off unless the person adds
 * `SEO_MCP_ALLOW_WRITES`, and a config that turned them on by default would let an agent open
 * pull requests for somebody who only meant to look.
 */
export function editorJson(input: EditorConfigInput): string {
  return JSON.stringify(
    {
      mcpServers: {
        rankwright: {
          ...launch(input),
          env: { SEO_API_URL: input.apiUrl, SEO_API_TOKEN: input.token },
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
 * On one line, and that is deliberate. It was first written across four lines joined with a
 * backslash, which is how a long command is usually shown and is only valid in a Unix shell.
 * Pasted into PowerShell or the Windows command prompt, a trailing backslash is not a line
 * continuation: the first line runs alone and the rest are errors. One line works in all of
 * them, and the block it is shown in scrolls sideways.
 */
export function claudeCodeCommand(input: EditorConfigInput): string {
  const { command, args } = launch(input)
  return [
    'claude mcp add rankwright',
    `--env SEO_API_URL=${input.apiUrl}`,
    `--env SEO_API_TOKEN=${input.token}`,
    `-- ${command} ${args.join(' ')}`,
  ].join(' ')
}

/** The steps that come first when the server is run from a clone. */
export const CLONE_STEPS = [
  `git clone ${REPOSITORY_URL}`,
  'cd seo-agent-capstone',
  'pnpm install',
  'pnpm build',
].join('\n')
