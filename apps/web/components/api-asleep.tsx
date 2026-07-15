/**
 * The API is on Render's free tier. It sleeps after about fifteen minutes idle and takes up
 * to a minute to wake.
 *
 * That is a real property of the product, not an embarrassment to hide behind a spinner. A
 * spinner says "this is working, keep waiting" and gives the user nothing to decide with. A
 * user who is told the truth waits; a user shown an endless spinner concludes the product is
 * broken and closes the tab. The same principle as the audit runner refusing to score a site
 * it never reached: say what is actually happening.
 */
export function ApiAsleep() {
  return (
    <main className="mt-10 rounded-lg border border-neutral-800 bg-neutral-950 p-6">
      <h1 className="text-lg font-medium text-neutral-200">The API is waking up</h1>

      <p className="mt-3 text-sm leading-relaxed text-neutral-500">
        It runs on a free instance that sleeps after about fifteen minutes of inactivity and takes
        up to a minute to start again. Nothing is broken, and no data is lost. Reload in a moment.
      </p>

      <p className="mt-3 text-sm leading-relaxed text-neutral-600">
        This is the honest cost of a stack that runs at zero dollars. Paying for an always-on
        instance is the fix, and it is a decision, not a bug report.
      </p>
    </main>
  )
}
