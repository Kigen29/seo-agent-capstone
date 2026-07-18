import Link from 'next/link'

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
  { n: '01', title: 'Crawl', body: 'We read your whole search surface.' },
  { n: '02', title: 'Diagnose', body: 'Deterministic rules find the issue.' },
  { n: '03', title: 'Prioritise', body: 'Sorted by impact over effort.' },
  { n: '04', title: 'Open a PR', body: 'A real fix, on a new branch.' },
  { n: '05', title: 'Verify', body: 'Proven in Search Console.' },
]

export default function Home() {
  return (
    <div>
      <nav
        className="nav"
        style={{ position: 'sticky', top: 0, background: 'var(--color-bg)', zIndex: 10 }}
      >
        <span className="nav-brand">RankWright</span>
        <a href="#how">How it works</a>
        <a href="#axes">The eight axes</a>
        <Link href="/login" className="btn btn-primary" style={{ marginLeft: 'var(--space-2)' }}>
          Sign in
        </Link>
      </nav>

      {/* Hero */}
      <section
        style={{
          maxWidth: 1120,
          margin: '0 auto',
          padding: '72px var(--space-4) 56px',
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1.1fr) minmax(0, 0.9fr)',
          gap: 'var(--space-8)',
          alignItems: 'center',
        }}
      >
        <div>
          <div className="card-kicker" style={{ marginBottom: 'var(--space-3)' }}>
            The SEO agent that ships the fix
          </div>
          <h1
            style={{
              fontWeight: 400,
              fontSize: 54,
              lineHeight: 1.05,
              marginBottom: 'var(--space-4)',
            }}
          >
            Most SEO tools hand you a report.{' '}
            <span style={{ color: 'var(--color-accent-700)' }}>
              We hand your repo a pull request.
            </span>
          </h1>
          <p
            style={{
              fontSize: 16,
              lineHeight: 1.75,
              opacity: 0.85,
              maxWidth: '52ch',
              marginBottom: 'var(--space-6)',
            }}
          >
            RankWright audits eight independent surfaces of your search presence, opens a pull
            request for what is broken, and waits for your review. You merge. We measure what
            actually moved, and say so when nothing did.
          </p>
          <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
            <Link href="/login" className="btn btn-primary">
              Run an audit
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
            <span style={{ fontSize: 12, opacity: 0.6 }}>
              rankwright[bot] opened a pull request
            </span>
          </div>
          <div style={{ padding: 'var(--space-4)' }}>
            <div className="card-kicker">seo-agent/perf-003</div>
            <div className="card-title" style={{ marginBottom: 'var(--space-3)' }}>
              Prioritise the LCP hero image
            </div>
            <div className="mono" style={{ padding: 0, lineHeight: 1.9 }}>
              <div style={{ padding: '4px 12px', opacity: 0.7 }}>app/page.tsx</div>
              <div style={{ padding: '4px 12px', color: 'var(--color-neutral-700)' }}>
                &minus; &lt;Image src="/hero.jpg" alt="&hellip;" /&gt;
              </div>
              <div style={{ padding: '4px 12px', color: 'var(--color-accent-700)' }}>
                + &lt;Image src="/hero.jpg" alt="&hellip;" priority /&gt;
              </div>
            </div>
          </div>
          <div
            style={{
              padding: 'var(--space-3) var(--space-4)',
              borderTop: '1px solid var(--color-divider)',
              fontSize: 12,
              opacity: 0.6,
            }}
          >
            Expected: p75 LCP 3.4s &rarr; under 2.5s. Verified up to 28 days after merge.
          </div>
        </div>
      </section>

      <hr className="hr" style={{ maxWidth: 1120, margin: '0 auto' }} />

      {/* The gap */}
      <section
        style={{ maxWidth: 1120, margin: '0 auto', padding: 'var(--space-8) var(--space-4)' }}
      >
        <div
          className="card-kicker"
          style={{ textAlign: 'center', marginBottom: 'var(--space-4)' }}
        >
          The gap
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)' }}>
          <div
            style={{ padding: '0 var(--space-4)', borderRight: '1px solid var(--color-divider)' }}
          >
            <h4 style={{ opacity: 0.6 }}>Dashboards</h4>
            <p style={{ opacity: 0.75 }}>Measure the problem, beautifully, forever.</p>
          </div>
          <div
            style={{ padding: '0 var(--space-4)', borderRight: '1px solid var(--color-divider)' }}
          >
            <h4 style={{ opacity: 0.6 }}>Crawlers</h4>
            <p style={{ opacity: 0.75 }}>Hand you a four-hundred-line list and wish you luck.</p>
          </div>
          <div style={{ padding: '0 var(--space-4)' }}>
            <h4 style={{ color: 'var(--color-accent-700)' }}>RankWright</h4>
            <p>Opens the pull request that fixes it, and proves it worked.</p>
          </div>
        </div>
      </section>

      <hr className="hr" style={{ maxWidth: 1120, margin: '0 auto' }} />

      {/* How it works */}
      <section
        id="how"
        style={{ maxWidth: 1120, margin: '0 auto', padding: 'var(--space-8) var(--space-4)' }}
      >
        <div
          className="card-kicker"
          style={{ textAlign: 'center', marginBottom: 'var(--space-6)' }}
        >
          How it works
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(5, 1fr)',
            gap: 'var(--space-4)',
            textAlign: 'center',
          }}
        >
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
              <h4 style={{ marginBottom: 'var(--space-1)' }}>{s.title}</h4>
              <p style={{ fontSize: 13, opacity: 0.75, margin: 0 }}>{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      <hr className="hr" style={{ maxWidth: 1120, margin: '0 auto' }} />

      {/* Eight axes */}
      <section
        id="axes"
        style={{ maxWidth: 1120, margin: '0 auto', padding: 'var(--space-8) var(--space-4)' }}
      >
        <div
          className="card-kicker"
          style={{ textAlign: 'center', marginBottom: 'var(--space-4)' }}
        >
          Eight surfaces, audited
        </div>
        <p
          style={{
            textAlign: 'center',
            fontSize: 14,
            opacity: 0.75,
            maxWidth: '54ch',
            margin: '0 auto var(--space-6)',
          }}
        >
          Eight scores, never one. The axes move independently, and a single number hides
          everything.
        </p>
        <div
          style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 'var(--space-3)' }}
        >
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
        <div className="card elev-sm" style={{ textAlign: 'center', padding: 'var(--space-8)' }}>
          <div className="card-kicker" style={{ marginBottom: 'var(--space-3)' }}>
            Honest to a fault
          </div>
          <h2 style={{ fontWeight: 400, maxWidth: '22ch', margin: '0 auto var(--space-4)' }}>
            When a fix does not move the needle, we are the ones who tell you.
          </h2>
          <Link href="/login" className="btn btn-primary">
            Sign in to run an audit
          </Link>
        </div>
      </section>

      <footer
        style={{
          borderTop: '1px solid var(--color-divider)',
          padding: 'var(--space-4)',
          maxWidth: 1120,
          margin: '0 auto',
          fontSize: 13,
          opacity: 0.7,
          display: 'flex',
          flexWrap: 'wrap',
          gap: 'var(--space-3)',
          justifyContent: 'space-between',
        }}
      >
        <span>
          <a href="https://github.com/Kigen29/seo-agent-capstone">Source on GitHub</a>
          <span style={{ margin: '0 8px', opacity: 0.4 }}>/</span>
          Quantic School of Business and Technology, MSSE Capstone, 2026
        </span>
        <span>Built in Nairobi. Priced for the whole world.</span>
      </footer>
    </div>
  )
}
