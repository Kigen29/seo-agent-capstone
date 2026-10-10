'use client'

import type { CreatedToken } from '@seo/api-client'
import { useRouter } from 'next/navigation'
import { useId, useState, useTransition } from 'react'
import { CopyBlock } from '@/components/ui/copy-block'
import { ErrorNote } from '@/components/ui/error-note'
import { Field } from '@/components/ui/field'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { claudeCodeCommand, CLONE_STEPS, editorJson, TOKEN_PLACEHOLDER } from '@/lib/editor-config'
import { formatDay } from '@/lib/format'
import { invalid, type UserError } from '@/lib/user-error'
import { createToken } from './actions'

/**
 * Connect an editor to this account: make a token, and get the config to paste.
 *
 * Until this existed the MCP server could be used by one person, the operator, because the only
 * way to make a token was a command that needs the production database. Everybody else could
 * read that the product was an MCP server and could not connect to it.
 *
 * The token is shown once, here, straight after it is made. It is not kept in the page after a
 * reload and cannot be fetched again, because only its hash is stored. The config under it is
 * filled in with the token while it is on screen, so the thing a person copies works as pasted.
 */
const LIFETIMES = [
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 365, label: '1 year' },
]

export function ConnectEditor({
  apiUrl,
  packageName,
}: {
  /** The API's public address, which the editor's server talks to. */
  apiUrl: string
  /** The published npm package, when there is one. */
  packageName?: string | undefined
}) {
  const id = useId()
  const router = useRouter()
  const [name, setName] = useState('My editor')
  const [days, setDays] = useState(90)
  const [made, setMade] = useState<CreatedToken | null>(null)
  const [error, setError] = useState<UserError | null>(null)
  const [pending, start] = useTransition()

  function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    if (!name.trim()) {
      setError(
        invalid(
          'Give the token a name',
          'Something you will recognise later, like the machine it is for.',
        ),
      )
      return
    }
    start(async () => {
      const result = await createToken(name.trim(), days)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setMade(result.data)
      // The list of tokens under this panel is drawn by the server, so ask for it again.
      router.refresh()
    })
  }

  const config = { apiUrl, token: made?.token ?? TOKEN_PLACEHOLDER, packageName }

  return (
    <section aria-labelledby="connect-heading" className="mb-10">
      <h2 id="connect-heading" className="h-section mb-1">
        Connect your editor
      </h2>
      <div className="text-muted mb-4 max-w-[68ch] text-sm">
        RankWright is also an MCP server, so Claude Code, Cursor, VS Code and other AI editors can
        read your findings, audits, outcomes and schedule, and open a fix as a pull request when you
        allow it. Make a token here, then paste the config below into your editor.
      </div>

      <form
        onSubmit={submit}
        className="card"
        style={{ padding: 'var(--space-5)', gap: 'var(--space-4)' }}
      >
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[220px] flex-1">
            <Field id={`${id}-name`} label="Name" help="So you can tell it apart later.">
              <input
                id={`${id}-name`}
                className="input"
                value={name}
                maxLength={60}
                onChange={(event) => setName(event.target.value)}
                autoComplete="off"
              />
            </Field>
          </div>
          <div>
            <Field id={`${id}-days`} label="Expires after" help="Every token expires.">
              <select
                id={`${id}-days`}
                className="input"
                value={days}
                onChange={(event) => setDays(Number(event.target.value))}
              >
                {LIFETIMES.map((lifetime) => (
                  <option key={lifetime.days} value={lifetime.days}>
                    {lifetime.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <button type="submit" className="btn btn-primary" disabled={pending}>
            {pending ? 'Creating...' : 'Create token'}
          </button>
        </div>
        <ErrorNote error={error} />

        {made && (
          <div role="status" className="note note-ok">
            <div className="font-semibold">
              Token &ldquo;{made.name}&rdquo; created. Copy it now.
            </div>
            <div className="mt-0.5">
              This is the only time it is shown. It works until {formatDay(made.expiresAt)}, or
              until you revoke it in the list below.
            </div>
          </div>
        )}
        {made && <CopyBlock label="Your token" text={made.token} what="the token" />}
      </form>

      <div className="mt-5">
        <h3 className="card-heading mb-2">
          {made ? 'Paste this into your editor' : 'What you will paste into your editor'}
        </h3>
        {!packageName && (
          <div className="mb-3">
            <div className="text-muted mb-2 max-w-[68ch] text-[13px]">
              The server runs on your own machine. Get it once, then replace the path in the config
              with where you put it:
            </div>
            <CopyBlock label="Get the server" text={CLONE_STEPS} what="the commands" />
          </div>
        )}
        <Tabs defaultValue="claude">
          <TabsList aria-label="Which editor">
            <TabsTrigger value="claude">Claude Code</TabsTrigger>
            <TabsTrigger value="json">Cursor, VS Code and others</TabsTrigger>
          </TabsList>
          <TabsContent value="claude">
            <CopyBlock
              label="Run this in a terminal"
              text={claudeCodeCommand(config)}
              what="the command"
            />
          </TabsContent>
          <TabsContent value="json">
            <CopyBlock
              label="Add this to your editor's MCP config file"
              text={editorJson(config)}
              what="the config"
            />
            <div className="text-muted max-w-[68ch] text-[13px]">
              Cursor reads <code>.cursor/mcp.json</code>. VS Code reads{' '}
              <code>.vscode/mcp.json</code>, where the top-level key is <code>servers</code> and not{' '}
              <code>mcpServers</code>.
            </div>
          </TabsContent>
        </Tabs>
        <div className="text-muted mt-3 max-w-[68ch] text-[13px]">
          It can only read until you add <code>SEO_MCP_ALLOW_WRITES=1</code> beside the other two
          values. With that, it can start an audit and open pull requests, at most three in one
          session, and never to your default branch.
        </div>
      </div>
    </section>
  )
}
