import type { Framework } from '@seo/core'
import type { FileChange } from '../engine.js'
import { headStrategyFor, type HeadStrategy, type ReadRepoFile } from '../framework/detect.js'

/**
 * Inject tags into a site's document head, in the right file for its framework.
 *
 * This is the shared mechanism behind the Search Console auto-verification (a
 * google-site-verification meta tag) and the head-based technical fixers to come (a canonical
 * link, removing a noindex). It is deterministic on purpose (ADR-0001 on the write side): it
 * finds a real `</head>` in a real file and inserts before it, or it does nothing. It never
 * guesses a location, so it cannot produce a broken file, and when it cannot find a head it
 * returns null rather than invent one, which the caller reports honestly instead of opening a
 * PR that would not work.
 */

/** A head tag, expressed structurally so it renders the same wherever it is written. */
export interface HeadTag {
  tag: 'meta' | 'link'
  attributes: Record<string, string>
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

/** Render a head tag to the exact string that will be written and matched for idempotency. */
export function renderTag(tag: HeadTag): string {
  const attrs = Object.entries(tag.attributes)
    .map(([name, value]) => `${name}="${escapeAttr(value)}"`)
    .join(' ')
  return `<${tag.tag} ${attrs} />`
}

/** The Search Console verification meta tag for a token. */
export function googleVerificationTag(token: string): HeadTag {
  return { tag: 'meta', attributes: { name: 'google-site-verification', content: token } }
}

/**
 * Where a `</head>` is likely to live, per strategy family. No globs, because the reader can
 * fetch a known path but not list a directory; a repo whose head is somewhere unlisted falls
 * through to null, which is the honest outcome. Ordered most-conventional first.
 */
const HEAD_FILES: Record<HeadStrategy, string[]> = {
  'spa-index': ['index.html', 'public/index.html', 'src/index.html'],
  'framework-head': [
    'app/layout.tsx',
    'src/app/layout.tsx',
    'app/layout.jsx',
    'pages/_document.tsx',
    'src/pages/_document.tsx',
    'app.vue',
    'src/App.vue',
    'src/layouts/Layout.astro',
    'src/layouts/BaseLayout.astro',
  ],
  'template-hook': ['header.php'],
  'static-layout': [
    'layouts/_default/baseof.html',
    'layouts/partials/head.html',
    '_layouts/default.html',
    '_includes/head.html',
  ],
  'server-template': ['templates/base.html', 'app/views/layouts/application.html.erb'],
  universal: ['index.html', 'public/index.html', 'src/index.html', '404.html'],
}

/**
 * Inject the given tags into the first candidate file that has a `</head>`.
 *
 * Returns the single file change, or null when no candidate file has a head (the caller cannot
 * auto-fix, and says so) or when every tag is already present (nothing to do). Only tags not
 * already in the file are inserted, so re-running is safe and never duplicates. The closing
 * tag's indentation is matched, so the diff reads as a hand edit.
 */
export async function injectHeadTags(
  framework: Framework,
  read: ReadRepoFile,
  tags: HeadTag[],
): Promise<FileChange | null> {
  if (tags.length === 0) return null

  const rendered = tags.map(renderTag)

  for (const path of HEAD_FILES[headStrategyFor(framework)]) {
    const content = await read(path)
    if (content === null) continue

    const closing = content.match(/([ \t]*)<\/head>/i)
    if (!closing) continue

    const missing = rendered.filter((tag) => !content.includes(tag))
    if (missing.length === 0) return null // already there; nothing to change

    // Indent the new tags one level deeper than `</head>`, so they line up with the head's
    // existing children rather than with the closing tag itself, and the diff reads as a hand edit.
    const indent = closing[1] ?? ''
    const childIndent = `${indent}  `
    const block = missing.map((tag) => `${childIndent}${tag}`).join('\n')
    const newContent = content.replace(/[ \t]*<\/head>/i, `${block}\n${indent}</head>`)

    return { path, content: newContent }
  }

  return null
}
