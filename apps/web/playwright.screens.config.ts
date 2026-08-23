import base from './playwright.config'

/**
 * The visual check, which the main config deliberately cannot run.
 *
 * `screens.manual.ts` is named to fall outside Playwright's default `testMatch`, so CI does not
 * spend a minute writing PNGs nobody reads. That part worked. What did not work is that the file's
 * own usage comment said to run it by passing the filename:
 *
 *     playwright test e2e/screens.manual.ts        # finds nothing
 *
 * A path argument is a *filter applied to files that already matched* `testMatch`, not an override
 * of it, so that command exits with "No tests found" and a zero status. There is no `--testMatch`
 * flag to reach for either. The harness has therefore been undocumented-and-unrunnable since it was
 * written, which is a poor state for the one check that exists because the type checker, the
 * linter and the e2e suite cannot see.
 *
 * A second config rather than a second project in the first one: `playwright test` runs every
 * project by default, so a `screens` project would rejoin the CI run it was named to escape.
 *
 *     pnpm --filter @seo/web screens
 */
export default {
  ...base,
  testMatch: '**/screens.manual.ts',
  // One browser, one worker, no retries. These are photographs, not assertions: a retry would
  // quietly overwrite a screenshot of the thing that went wrong with one of a second attempt.
  retries: 0,
  workers: 1,
  /**
   * Five minutes for the whole session, against the base config's sixty seconds.
   *
   * The capture is a single test that visits thirteen pages, and the base timeout is sized for an
   * assertion: one page, one claim. Applied here it ran out somewhere around the tenth screenshot
   * and reported a timeout, which reads exactly like a broken page and is not one. Each navigation
   * also pays for whatever the database is doing, and this is the run where that is least worth
   * rushing.
   */
  timeout: 300_000,
}
