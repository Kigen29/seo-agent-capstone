import { describe, expect, it } from 'vitest'
import {
  claudeCodeCommand,
  CLONE_SERVER_PATH,
  editorJson,
  TOKEN_PLACEHOLDER,
} from './editor-config'

const base = { apiUrl: 'https://api.example', token: 'seo_abc' }

describe('editorJson', () => {
  it('is valid JSON an editor can read, with the address and the token in the environment', () => {
    const config = JSON.parse(editorJson({ ...base, packageName: 'rankwright-mcp' }))
    expect(config.mcpServers.rankwright).toEqual({
      command: 'npx',
      args: ['-y', 'rankwright-mcp'],
      env: { SEO_API_URL: 'https://api.example', SEO_API_TOKEN: 'seo_abc' },
    })
  })

  it('runs the server from a clone when there is no published package', () => {
    const config = JSON.parse(editorJson(base))
    expect(config.mcpServers.rankwright.command).toBe('node')
    expect(config.mcpServers.rankwright.args).toEqual([CLONE_SERVER_PATH])
    // Never an npx command for a package that is not on the registry.
    expect(editorJson(base)).not.toContain('npx')
  })

  it('never switches writes on for somebody', () => {
    for (const input of [base, { ...base, packageName: 'rankwright-mcp' }]) {
      expect(editorJson(input)).not.toContain('SEO_MCP_ALLOW_WRITES')
      expect(claudeCodeCommand(input)).not.toContain('SEO_MCP_ALLOW_WRITES')
    }
  })

  it('can be read before a token exists', () => {
    expect(editorJson({ ...base, token: TOKEN_PLACEHOLDER })).toContain(TOKEN_PLACEHOLDER)
  })
})

describe('claudeCodeCommand', () => {
  it('is one command, with the server after the double dash', () => {
    const command = claudeCodeCommand({ ...base, packageName: 'rankwright-mcp' })
    expect(command.startsWith('claude mcp add rankwright')).toBe(true)
    expect(command).toContain('--env SEO_API_URL=https://api.example')
    expect(command).toContain('--env SEO_API_TOKEN=seo_abc')
    expect(command.trimEnd().endsWith('-- npx -y rankwright-mcp')).toBe(true)
  })

  it('is a single line, so it can be pasted into PowerShell as well as a Unix shell', () => {
    for (const input of [base, { ...base, packageName: 'rankwright-mcp' }]) {
      const command = claudeCodeCommand(input)
      expect(command).not.toContain('\n')
      // A trailing backslash continues a line in bash and nowhere on Windows.
      expect(command).not.toContain('\\')
    }
  })

  it('points at the built file in a clone otherwise', () => {
    expect(claudeCodeCommand(base).trimEnd().endsWith(`-- node ${CLONE_SERVER_PATH}`)).toBe(true)
  })
})
