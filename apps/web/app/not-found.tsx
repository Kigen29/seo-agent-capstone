import Link from 'next/link'

/**
 * The 404, which is load-bearing here in a way it usually is not.
 *
 * The API refuses to distinguish "does not exist" from "belongs to another tenant" (ADR-0009),
 * because a 403 would confirm a row is real and let someone enumerate ids across the platform. So
 * this page is what a user sees when they open somebody else's audit, and the e2e suite asserts
 * it says nothing about permission. Until now it was Next's unstyled default: correct, and a
 * jarring drop out of the product at the one moment the product is making a security decision.
 *
 * The copy states both possibilities without choosing, because we genuinely do not know which it
 * is: row-level security means the query came back empty, and the handler cannot tell either.
 */
export default function NotFound() {
  return (
    <main id="main" className="wrap">
      <div className="card elev-sm" style={{ maxWidth: 620 }}>
        <div className="card-kicker">Not found</div>
        <h3 style={{ margin: '0 0 var(--space-3)' }}>There is nothing here</h3>

        <p style={{ fontSize: 14 }}>
          This page does not exist, or it belongs to another account. We do not say which, and that
          is deliberate: telling you a record exists but is not yours would confirm it is real to
          anyone who went looking.
        </p>

        <div className="flex flex-wrap" style={{ gap: 'var(--space-2)' }}>
          <Link href="/dashboard" className="btn btn-primary">
            Back to your sites
          </Link>
          <Link href="/findings" className="btn btn-secondary">
            Findings
          </Link>
        </div>
      </div>
    </main>
  )
}
