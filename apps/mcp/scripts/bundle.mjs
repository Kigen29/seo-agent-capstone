#!/usr/bin/env node
import console from 'node:console'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

/**
 * Build the MCP server as one file that can be published to npm and run with `npx`.
 *
 * Inside this repository the server is a workspace package: it imports `@seo/api-client` and
 * `@seo/core`, which exist only here. Nobody outside can install that. This writes
 * `apps/mcp/publish/` with a single `server.js` that has everything inlined, a `package.json`
 * with a `bin`, and a README, so that
 *
 *   npx -y rankwright-mcp
 *
 * starts the same server with no checkout and no build.
 *
 *   pnpm build && pnpm --filter @seo/mcp bundle
 *   SEO_MCP_SERVER=apps/mcp/publish/server.js pnpm --filter @seo/mcp smoke   # check it first
 *   cd apps/mcp/publish && npm publish --access public
 *
 * The directory is generated and not committed. `MCP_PACKAGE_NAME` changes the name, for a
 * scoped package or if the plain one is taken.
 */

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const out = resolve(root, 'publish')
const name = process.env.MCP_PACKAGE_NAME ?? 'rankwright-mcp'
const { version } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))

mkdirSync(out, { recursive: true })

const result = await build({
  entryPoints: [resolve(root, 'src/server.ts')],
  outfile: resolve(out, 'server.js'),
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  // Some dependencies are CommonJS and call `require` for Node's own modules. An ES module has
  // no `require`, so give the bundle one.
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module';\nconst require = __createRequire(import.meta.url);",
  },
  legalComments: 'none',
  metafile: true,
  logLevel: 'warning',
})

writeFileSync(
  resolve(out, 'package.json'),
  `${JSON.stringify(
    {
      name,
      version,
      description:
        'MCP server for RankWright: read SEO findings, audits, fix outcomes, AI visibility and the schedule from your editor, and open a fix as a pull request.',
      type: 'module',
      bin: { [name.replace(/^@[^/]+\//, '')]: 'server.js' },
      files: ['server.js', 'README.md', 'LICENSE'],
      engines: { node: '>=20' },
      keywords: ['mcp', 'model-context-protocol', 'seo', 'pull-request', 'claude', 'cursor'],
      repository: { type: 'git', url: 'git+https://github.com/Kigen29/seo-agent-capstone.git' },
      homepage: 'https://seo-agent-capstone.vercel.app',
      license: 'MIT',
    },
    null,
    2,
  )}\n`,
)

writeFileSync(
  resolve(out, 'README.md'),
  `# ${name}

The [RankWright](https://seo-agent-capstone.vercel.app) MCP server. It lets an AI editor (Claude
Code, Cursor, VS Code and others) read your site's SEO findings, audits, fix outcomes, AI
visibility and schedule, and open a fix as a pull request when you allow it.

It runs on your machine and talks to the RankWright API with a token from your own account.

## Connect

1. Sign in to RankWright, open **Settings, Account and spend**, and create a token under
   **Connect your editor**. It is shown once.
2. Add the server to your editor.

Claude Code:

\`\`\`bash
claude mcp add rankwright \\
  --env SEO_API_URL=https://seo-agent-capstone.onrender.com \\
  --env SEO_API_TOKEN=seo_your_token \\
  -- npx -y ${name}
\`\`\`

Cursor (\`.cursor/mcp.json\`) and most other editors:

\`\`\`json
{
  "mcpServers": {
    "rankwright": {
      "command": "npx",
      "args": ["-y", "${name}"],
      "env": {
        "SEO_API_URL": "https://seo-agent-capstone.onrender.com",
        "SEO_API_TOKEN": "seo_your_token"
      }
    }
  }
}
\`\`\`

## Tools

| | Tools |
|---|---|
| Findings and audits | \`list_sites\`, \`list_findings\`, \`get_finding\`, \`get_audit\`, \`audit_status\`, \`list_audits\`, \`audit_changes\` |
| Reports | \`get_outcomes\`, \`get_visibility\`, \`get_competitor_watch\`, \`get_schedule\` |
| Billed research | \`keyword_ideas\`, \`keyword_gap\` |
| Writes, off by default | \`run_audit\`, \`fix_finding\`, \`verify_site\`, \`set_audit_schedule\` |

## Writes are off until you turn them on

Without anything else set, the server can only read. Add \`SEO_MCP_ALLOW_WRITES=1\` beside the
other two values and it can start an audit and open pull requests. A pull request never goes to
your default branch, a person still merges it, and one session opens at most three
(\`SEO_MCP_MAX_PRS\` changes that).

## Environment

| Variable | |
|---|---|
| \`SEO_API_URL\` | The API's address. Required. |
| \`SEO_API_TOKEN\` | A token from your account. Required. |
| \`SEO_MCP_ALLOW_WRITES\` | \`1\` to offer the write tools. Default off. |
| \`SEO_MCP_MAX_PRS\` | Pull requests one session may open. Default 3. |

The first call after a quiet spell can take up to a minute: the API runs on a free instance that
sleeps when idle.

## Licence

MIT.
`,
)

// The licence travels with the code. It is the repository's own file, copied and not retyped.
copyFileSync(resolve(root, '../../LICENSE'), resolve(out, 'LICENSE'))

const bytes = Object.values(result.metafile.outputs)[0].bytes
console.log(`${name}@${version}: ${out} (server.js, ${Math.round(bytes / 1024)} KB)`)
