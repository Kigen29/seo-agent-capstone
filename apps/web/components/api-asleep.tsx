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
    <div className="wrap">
      <div className="card elev-sm" style={{ padding: 'var(--space-6)', maxWidth: 620 }}>
        <div className="card-kicker">Waking up</div>
        <h3 style={{ margin: '0 0 var(--space-3)' }}>The API is starting</h3>

        <p style={{ fontSize: 14, opacity: 0.85 }}>
          It runs on a free instance that sleeps after about fifteen minutes of inactivity and takes
          up to a minute to start again. Nothing is broken, and no data is lost. Reload in a moment.
        </p>

        <p style={{ fontSize: 14, opacity: 0.65, margin: 0 }}>
          This is the honest cost of a stack that runs at zero dollars. Paying for an always-on
          instance is the fix, and it is a decision, not a bug report.
        </p>
      </div>
    </div>
  )
}
