import type { Metadata } from 'next'
import Link from 'next/link'
import { startWithSite } from './onboarding/actions'

const AXES = [
  'Crawl health',
  'Performance',
  'Content',
  'Structure',
  'Authority',
  'Local',
  'AI visibility',
  'Agent readiness',
]

const STEPS = [
  { n: '01', title: 'Crawl', body: 'We crawl up to 50 pages per audit.' },
  { n: '02', title: 'Diagnose', body: 'Deterministic rules find the issue.' },
  { n: '03', title: 'Prioritise', body: 'Sorted by impact over effort.' },
  { n: '04', title: 'Open a PR', body: 'A real fix, on a new branch.' },
  { n: '05', title: 'Verify', body: 'Rechecked after deployment.' },
]

/** The homepage names itself as the canonical. No other page inherits this. */
export const metadata: Metadata = { alternates: { canonical: '/' } }

export default function Home() {
  return (
    <div>
      <nav
        className="nav"
        aria-label="Site"
        style={{ position: 'sticky', top: 0, background: 'var(--color-bg)', zIndex: 10 }}
      >
        <span className="nav-brand">RankWright</span>
        <a href="#how">How it works</a>
        <a href="#areas">The eight areas</a>
        <Link href="/login" className="btn btn-primary" style={{ marginLeft: 'var(--space-2)' }}>
          Sign in
        </Link>
      </nav>

      <main id="main">
        {/* Hero */}
        <section className="mx-auto grid max-w-[1120px] items-center gap-8 px-4 pt-12 pb-10 md:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] md:pt-[72px] md:pb-14">
          <div>
            <div className="card-kicker mb-3">The SEO agent that ships the fix</div>
            <h1 className="display mb-4 leading-[1.05]">
              Most SEO tools hand you a report.{' '}
              <span style={{ color: 'var(--color-accent-700)' }}>
                We hand your repo a pull request.
              </span>
            </h1>
            <p
              style={{
                fontSize: 16,
                lineHeight: 1.75,
                maxWidth: '52ch',
                marginBottom: 'var(--space-6)',
              }}
            >
              RankWright checks your search presence across eight separate areas and proposes pull
              requests for supported fixes. You review and merge. We recheck the deployed change and
              report what we can measure. Some areas need connected accounts or paid data.
            </p>
            {/*
            The address is asked for here, before sign-in, and carried through it. Somebody who
            has just typed their site arrives signed in with the first step of setup filled in,
            not on an empty dashboard wondering where to begin.
          */}
            <form
              action={startWithSite}
              className="mb-3 flex max-w-[520px] flex-wrap gap-2"
              aria-label="Start with your site"
            >
              <input
                name="url"
                type="text"
                inputMode="url"
                autoComplete="url"
                aria-label="Your website address"
                placeholder="yourwebsite.com"
                className="input"
                style={{ flex: 1, minWidth: 200 }}
              />
              <button type="submit" className="btn btn-primary">
                Audit my site
              </button>
            </form>
            <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
              {/*
              The free check, second rather than first. It is the cheapest way to see whether any
              of this is true, and it is still not the product: the product opens the pull request.
            */}
              <Link href="/check" className="btn btn-secondary">
                Check one page free
              </Link>
              <a href="#how" className="btn btn-secondary">
                See how it works
              </a>
            </div>
          </div>

          {/* PR mockup */}
          <div className="card elev-md" style={{ padding: 0, overflow: 'hidden' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-2)',
                padding: 'var(--space-3)',
                borderBottom: '1px solid var(--color-divider)',
              }}
            >
              <span className="tag tag-outline">Open</span>
              <span className="text-muted" style={{ fontSize: 12 }}>
                rankwright[bot] opened a pull request
              </span>
            </div>
            <div style={{ padding: 'var(--space-4)' }}>
              <div className="card-kicker">seo-agent/tech-002</div>
              <div className="card-title" style={{ marginBottom: 'var(--space-3)' }}>
                Allow AI search crawlers
              </div>
              <div className="mono" style={{ padding: 0, lineHeight: 1.9 }}>
                <div className="text-muted" style={{ padding: '4px 12px' }}>
                  public/robots.txt
                </div>
                <div style={{ padding: '4px 12px', color: 'var(--color-neutral-700)' }}>
                  &minus; Disallow: /
                </div>
                <div style={{ padding: '4px 12px', color: 'var(--color-accent-700)' }}>
                  + Allow: /
                </div>
              </div>
            </div>
            <div
              className="text-muted"
              style={{
                padding: 'var(--space-3) var(--space-4)',
                borderTop: '1px solid var(--color-divider)',
                fontSize: 12,
              }}
            >
              Example: allow OAI-SearchBot in robots.txt. Rechecked after confirmed deployment;
              access does not guarantee citation.
            </div>
          </div>
        </section>

        <hr className="hr" style={{ maxWidth: 1120, margin: '0 auto' }} />

        {/* The gap */}
        <section
          style={{ maxWidth: 1120, margin: '0 auto', padding: 'var(--space-8) var(--space-4)' }}
        >
          <h2
            className="card-kicker"
            style={{ textAlign: 'center', marginBottom: 'var(--space-4)' }}
          >
            The gap
          </h2>
          <div className="grid gap-4 md:grid-cols-3 md:gap-0">
            <div
              style={{ padding: '0 var(--space-4)', borderRight: '1px solid var(--color-divider)' }}
            >
              <h3 className="text-muted">Dashboards</h3>
              <p className="text-muted">Measure the problem, beautifully, forever.</p>
            </div>
            <div
              style={{ padding: '0 var(--space-4)', borderRight: '1px solid var(--color-divider)' }}
            >
              <h3 className="text-muted">Crawlers</h3>
              <p className="text-muted">Hand you a four-hundred-line list and wish you luck.</p>
            </div>
            <div style={{ padding: '0 var(--space-4)' }}>
              <h3 style={{ color: 'var(--color-accent-700)' }}>RankWright</h3>
              <p>Proposes supported fixes as pull requests and checks the deployed result.</p>
            </div>
          </div>
        </section>

        <hr className="hr" style={{ maxWidth: 1120, margin: '0 auto' }} />

        {/* How it works */}
        <section
          id="how"
          style={{ maxWidth: 1120, margin: '0 auto', padding: 'var(--space-8) var(--space-4)' }}
        >
          <h2
            className="card-kicker"
            style={{ textAlign: 'center', marginBottom: 'var(--space-6)' }}
          >
            How it works
          </h2>
          <div className="grid grid-cols-2 gap-4 text-center sm:grid-cols-3 lg:grid-cols-5">
            {STEPS.map((s) => (
              <div key={s.n}>
                <div
                  style={{
                    fontFamily: 'var(--font-heading)',
                    fontSize: 22,
                    color: 'var(--color-accent-700)',
                    marginBottom: 'var(--space-2)',
                  }}
                >
                  {s.n}
                </div>
                <h3 style={{ marginBottom: 'var(--space-1)' }}>{s.title}</h3>
                <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
                  {s.body}
                </p>
              </div>
            ))}
          </div>
        </section>

        <hr className="hr" style={{ maxWidth: 1120, margin: '0 auto' }} />

        {/* Eight axes */}
        <section
          id="areas"
          style={{ maxWidth: 1120, margin: '0 auto', padding: 'var(--space-8) var(--space-4)' }}
        >
          <h2
            className="card-kicker"
            style={{ textAlign: 'center', marginBottom: 'var(--space-4)' }}
          >
            Eight areas, audited
          </h2>
          <p
            className="text-muted"
            style={{
              textAlign: 'center',
              fontSize: 14,
              maxWidth: '54ch',
              margin: '0 auto var(--space-6)',
            }}
          >
            Eight scores, never one. The areas move independently, and a single number hides
            everything.
          </p>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {AXES.map((a) => (
              <div
                key={a}
                style={{
                  border: '1px solid var(--color-divider)',
                  borderRadius: 'var(--radius-md)',
                  padding: 'var(--space-3)',
                  textAlign: 'center',
                  fontSize: 14,
                }}
              >
                {a}
              </div>
            ))}
          </div>
        </section>

        <section style={{ maxWidth: 1120, margin: '0 auto', padding: '0 var(--space-4) 72px' }}>
          {/*
          `items-center` matters here. `.card` is a flex column and its default `align-items:
          stretch` made every child full width: the heading sat left-aligned inside a 22ch box that
          `mx-auto` could not centre, and the call to action rendered as a bar spanning the whole
          card rather than a button.
        */}
          <div className="card elev-sm items-center p-8 text-center">
            <div className="card-kicker mb-3">Honest to a fault</div>
            <h2 className="mb-4 max-w-[22ch]">
              When a fix does not move the needle, we are the ones who tell you.
            </h2>
            <Link href="/login" className="btn btn-primary">
              Sign in to run an audit
            </Link>
          </div>
        </section>
      </main>

      <footer
        className="text-muted"
        style={{
          borderTop: '1px solid var(--color-divider)',
          padding: 'var(--space-4)',
          maxWidth: 1120,
          margin: '0 auto',
          fontSize: 13,
          display: 'flex',
          flexWrap: 'wrap',
          gap: 'var(--space-3)',
          justifyContent: 'space-between',
        }}
      >
        <span>
          <a href="https://github.com/Kigen29/seo-agent-capstone">Source on GitHub</a>
          <span aria-hidden="true" style={{ margin: '0 8px' }}>
            /
          </span>
          Quantic School of Business and Technology, MSSE Capstone, 2026
        </span>
        <span>Built in Nairobi. Priced for the whole world.</span>
      </footer>
    </div>
  )
}
