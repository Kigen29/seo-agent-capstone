import Link from 'next/link'
import type { Metadata } from 'next'
import { CheckForm } from './check-form'

export const metadata: Metadata = {
  title: 'Check a page — Rankwright',
  description:
    'Paste a URL and see the eight-axis breakdown, with the evidence for every finding. No account.',
}

/**
 * The free front door (ADR-0025).
 *
 * What it refuses to be is as important as what it is. The tool this competes with returns a
 * letter grade out of 100 and puts the explanations behind an email address; this returns the
 * same eight-axis breakdown a paying client sees, with the evidence attached, and asks for
 * nothing. A score would hide which axis is failing, which is the one thing a person pasting a
 * URL actually wants to know.
 */
export default function CheckPage() {
  return (
    <main id="main" className="wrap" style={{ paddingBlock: 'var(--space-8)' }}>
      <p className="card-kicker">Free check</p>
      <h1 className="display mb-3 leading-[1.05]">What is wrong with this page?</h1>
      <p className="text-muted mt-0 mb-6 max-w-[62ch]">
        Paste a URL. You get the same eight-axis breakdown a client sees, with the evidence behind
        every finding, and no score out of ten: the axes move independently and one number would
        hide which one is failing.
      </p>

      <CheckForm />

      <p className="text-muted mt-6 mb-0 max-w-[62ch] text-sm">
        This reads one page. A full audit crawls the site, measures Core Web Vitals from real Chrome
        users, reads your Search Console, and opens pull requests that fix what it finds.{' '}
        <Link href="/login">Sign in</Link> for that.
      </p>
    </main>
  )
}
