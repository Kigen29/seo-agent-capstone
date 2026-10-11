import { describe, expect, it } from 'vitest'
import {
  claudeCodeCommand,
  CLONE_SERVER_PATH,
  editorJson,
  TOKEN_PLACEHOLDER,
} from './editor-config'

const base = { apiUrl: 'https://api.example', token: 'seo_abc' }
const published = { ...base, packageName: 'rankwright-mcp' }

describe('editorJson', () => {
  it('is valid JSON an editor can read, with the address and the token in the environment', () => {
    const config = JSON.parse(editorJson(published))
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

  it('can be read before a token exists', () => {
    expect(editorJson({ ...base, token: TOKEN_PLACEHOLDER })).toContain(TOKEN_PLACEHOLDER)
  })
})

describe('writes', () => {
  it('are off in every config unless they were asked for', () => {
    for (const input of [base, published]) {
      expect(editorJson(input)).not.toContain('SEO_MCP_ALLOW_WRITES')
      expect(claudeCodeCommand(input)).not.toContain('SEO_MCP_ALLOW_WRITES')
    }
  })

  it('are one more value beside the other two when they were', () => {
    const config = JSON.parse(editorJson({ ...published, allowWrites: true }))
    expect(config.mcpServers.rankwright.env).toEqual({
      SEO_API_URL: 'https://api.example',
      SEO_API_TOKEN: 'seo_abc',
      SEO_MCP_ALLOW_WRITES: '1',
    })
    expect(claudeCodeCommand({ ...published, allowWrites: true })).toContain(
      '--env SEO_MCP_ALLOW_WRITES=1',
    )
  })
})

describe('claudeCodeCommand', () => {
  it('registers the published package for the whole account', () => {
    expect(claudeCodeCommand(published)).toBe(
      'claude mcp add --env SEO_API_URL=https://api.example --env SEO_API_TOKEN=seo_abc ' +
        '--env npm_config_yes=true --scope user rankwright npx rankwright-mcp',
    )
  })

  it('points at the built file in a clone otherwise, and tells npx nothing', () => {
    const command = claudeCodeCommand(base)
    expect(command.endsWith(`rankwright node ${CLONE_SERVER_PATH}`)).toBe(true)
    expect(command).not.toContain('npm_config_yes')
  })

  /*
    The ways this command has failed on Windows, each found by a person running it. A shell is
    not something this code can choose, so the command has to survive all of them.
  */
  describe('survives being pasted into PowerShell, the command prompt and a Unix shell', () => {
    const commands = [base, published, { ...published, allowWrites: true }].map(claudeCodeCommand)

    it('is one line with no backslash, which only continues a line on Unix', () => {
      for (const command of commands) {
        expect(command).not.toContain('\n')
        expect(command).not.toContain('\\')
      }
    })

    it('has no bare double dash, which PowerShell consumes before the program sees it', () => {
      for (const command of commands) expect(command.split(' ')).not.toContain('--')
    })

    it('has nothing that looks like an option after the name of the server', () => {
      for (const command of commands) {
        const after = command.slice(command.indexOf(' rankwright ') + ' rankwright '.length)
        for (const word of after.split(' ')) expect(word.startsWith('-')).toBe(false)
      }
    })

    it('closes the list of environment values with another option before the name', () => {
      // `--env` takes any number of values, and would otherwise take the name as one of them.
      for (const command of commands) expect(command).toMatch(/--scope user rankwright /)
    })

    it('uses no quotes, which each shell reads differently', () => {
      for (const command of commands) expect(command).not.toMatch(/["'`]/)
    })
  })
})
