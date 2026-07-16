import Link from 'next/link'

const AXES = [
  { name: 'Crawl health', detail: 'robots.txt, sitemaps, canonicals, indexation, AI crawlers' },
  { name: 'Performance', detail: 'Core Web Vitals from CrUX field data, at p75' },
  { name: 'Content', detail: 'depth, originality, freshness, cannibalisation, quick wins' },
  { name: 'Structure', detail: 'internal link graph, click depth, schema.org' },
  { name: 'Authority', detail: 'referring domains, brand mentions, digital PR' },
  { name: 'Local', detail: 'Google Business Profile, NAP, geo-grid' },
  { name: 'AI visibility', detail: 'citation rate and stability across engines' },
  { name: 'Agent readiness', detail: 'llms.txt, Agentic Browsing, accessibility tree' },
]

const LOOP = ['crawl', 'diagnose', 'prioritise', 'open a PR', 'human merges', 'verify', 'prove it']

export default function Home() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-20">
      <header className="flex items-baseline justify-between">
        <p className="text-sm font-medium tracking-widest text-neutral-500 uppercase">Rankwright</p>
        <Link
          href="/login"
          className="rounded-md bg-emerald-500 px-3 py-1.5 text-sm font-medium text-neutral-950 hover:bg-emerald-400"
        >
          Sign in
        </Link>
      </header>

      <h1 className="mt-10 text-4xl leading-tight font-semibold text-neutral-50 sm:text-5xl">
        Every other AI-SEO tool sends your marketer a list.
        <br />
        <span className="text-emerald-400">We send your repo a pull request.</span>
      </h1>

      <p className="mt-8 text-lg leading-relaxed text-neutral-400">
        An autonomous SEO agent that connects to your Git repository, audits eight independent
        surfaces of your search presence, and then opens pull requests that fix what it found. Not a
        recommendation. A diff, with the evidence, the rollback plan, and the exact condition under
        which we would admit we were wrong.
      </p>

      <ol className="mt-10 flex flex-wrap items-center gap-x-2 gap-y-2 text-sm text-neutral-500">
        {LOOP.map((step, i) => (
          <li key={step} className="flex items-center gap-2">
            <span className="rounded border border-neutral-800 bg-neutral-900 px-2 py-1 font-mono">
              {step}
            </span>
            {i < LOOP.length - 1 && <span aria-hidden="true">&rarr;</span>}
          </li>
        ))}
      </ol>

      <h2 className="mt-16 text-xs font-medium tracking-widest text-neutral-500 uppercase">
        The eight axes
      </h2>
      <p className="mt-3 text-sm text-neutral-500">
        Eight scores, never one. The axes move independently, and a single number hides everything.
      </p>

      <ul className="mt-6 grid gap-px overflow-hidden rounded-lg border border-neutral-800 bg-neutral-800 sm:grid-cols-2">
        {AXES.map((axis) => (
          <li key={axis.name} className="bg-neutral-950 p-4">
            <p className="font-medium text-neutral-200">{axis.name}</p>
            <p className="mt-1 text-sm text-neutral-500">{axis.detail}</p>
          </li>
        ))}
      </ul>

      <footer className="mt-16 border-t border-neutral-900 pt-8 text-sm text-neutral-600">
        <p>
          Sprint 1 is live: the crawler, the deterministic rule engine, the eight-axis scorecard,
          and the findings inbox.{' '}
          <Link
            href="/login"
            className="text-emerald-400 underline underline-offset-4 hover:text-emerald-300"
          >
            Sign in to run an audit.
          </Link>
        </p>
        <p className="mt-3">
          <a
            className="text-neutral-400 underline underline-offset-4 hover:text-neutral-200"
            href="https://github.com/Kigen29/seo-agent-capstone"
          >
            Source on GitHub
          </a>
          <span className="mx-2 text-neutral-800">/</span>
          Quantic School of Business and Technology, MSSE Capstone, 2026
        </p>
      </footer>
    </main>
  )
}
