import Link from 'next/link'
import { signOut } from '@/app/login/actions'

/**
 * The app chrome. One nav across every authenticated page, so "where am I" and "sign out" live
 * in the same place everywhere. Level and Findings are real destinations; Soundboard and Backstop
 * are on the roadmap (the verified-impact ledger and the auto-revert guardrails), shown muted so
 * the nav reads as designed without linking anywhere that does not exist yet.
 */
export function AppNav({ active }: { active?: 'level' | 'findings' }) {
  return (
    <nav className="nav">
      <Link href="/dashboard" className="nav-brand" style={{ color: 'inherit' }}>
        RankWright
      </Link>
      <Link href="/dashboard" aria-current={active === 'level' ? 'page' : undefined}>
        Level
      </Link>
      <Link href="/findings" aria-current={active === 'findings' ? 'page' : undefined}>
        Findings
      </Link>
      <span style={{ fontSize: 14, opacity: 0.4, cursor: 'default' }} title="On the roadmap">
        Soundboard
      </span>
      <span style={{ fontSize: 14, opacity: 0.4, cursor: 'default' }} title="On the roadmap">
        Backstop
      </span>
      <form action={signOut} style={{ marginLeft: 'var(--space-2)' }}>
        <button type="submit" className="btn btn-ghost" style={{ fontSize: 13 }}>
          Sign out
        </button>
      </form>
    </nav>
  )
}
