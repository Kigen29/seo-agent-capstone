import { OutcomeNote, outcomeFor, type Outcome } from './ui/outcome-note'

/**
 * The banner shown after the GitHub App install flow redirects back to the dashboard.
 *
 * Repositories connect per site, not from one panel, so this is a top-level status line rather
 * than a connection card: it says what just happened, and the per-site rows show what is now
 * connected. Each outcome reads differently, for the same reason the Google banner does:
 * "declined", "expired link", and "failed" are not the same event.
 */

/** The statuses the GitHub setup callback redirects with. See backToDashboardGithub. */
const CALLBACK: Record<string, Outcome> = {
  connected: {
    tone: 'ok',
    title: 'Repository connected',
    detail: 'Fixes can now arrive as pull requests for you to review.',
  },
  declined: {
    tone: 'info',
    title: 'Nothing was connected',
    detail: 'The install was cancelled on GitHub. You can connect whenever you are ready.',
  },
  invalid: {
    tone: 'warn',
    title: 'That link had expired',
    detail: 'It is good for a few minutes and for one use. Start the connection again from here.',
  },
  unavailable: {
    tone: 'info',
    title: 'Connecting a repository is not switched on here',
    detail: 'The GitHub App has not been set up on this installation yet.',
  },
  failed: {
    tone: 'error',
    title: 'We could not finish connecting the repository',
    detail: 'That is a fault on our side, not something you did. Try again in a moment.',
  },
  norepo: {
    tone: 'warn',
    title: 'No repository was chosen',
    detail:
      'The app was installed without access to any repository. Connect again and select the one that holds this site.',
  },
}

export function RepoCallback({ callback }: { callback?: string }) {
  return <OutcomeNote outcome={outcomeFor(CALLBACK, callback)} className="mt-4" />
}
