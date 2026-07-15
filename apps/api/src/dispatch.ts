/**
 * Nudge the GitHub Actions worker to wake up and drain the queue now.
 *
 * This is a nudge, not the delivery mechanism. The job is already durably in pg-boss by the
 * time this fires, and worker.yml drains on a 15-minute schedule regardless, so a failed or
 * unconfigured dispatch only means the audit starts a little later, never that it is lost.
 * That is why every failure here is swallowed: the worst case is a wait, not a dropped job,
 * and taking the API request down for it would trade a minor delay for a visible error.
 *
 * Absent credentials are the normal local and CI case, and they simply skip the nudge.
 */
export function makeDispatcher(): () => Promise<void> {
  const repo = process.env.GITHUB_WORKER_REPO
  const token = process.env.GITHUB_WORKER_TOKEN

  if (!repo || !token) {
    return async () => {
      // No worker repo configured. The schedule in worker.yml will drain the queue.
    }
  }

  return async () => {
    try {
      await fetch(`https://api.github.com/repos/${repo}/dispatches`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/vnd.github+json',
          'x-github-api-version': '2022-11-28',
        },
        body: JSON.stringify({ event_type: 'run-jobs' }),
        signal: AbortSignal.timeout(10_000),
      })
    } catch {
      // Swallowed on purpose: the job is queued, the schedule will get it.
    }
  }
}
