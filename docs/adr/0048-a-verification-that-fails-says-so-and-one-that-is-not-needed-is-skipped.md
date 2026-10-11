# ADR-0048: A verification that fails says so, and one that is not needed is skipped

- Status: Accepted; builds on ADR-0003 and the Search Console verification flow
- Date: 2026-10-11

## Context

Verifying a Search Console property by pull request is the feature this product leads with. On the first real account it did nothing, three times in four days, and the account owner asked two questions that both turned out to be defects.

**"I clicked, and nothing happened."** The request was accepted and reached the worker each time. The worker log for the latest reads `verify-v2 job failed: Google token refresh failed: 400`. Google had stopped accepting the saved sign-in. Nothing wrote that anywhere a person could see:

- The site stayed on `none`, so the page still offered the button, as if it had never been pressed.
- The connection has a row whether or not Google will honour it, and "is there a row" was the whole test. So the dashboard, the top bar and the settings page all said Google was connected.
- The button redirected to the dashboard with a banner that said verification had started. From the site setup page that was a different page, about something else.

**"Why is this step needed if I already connected Search Console?"** Often it is not. Connecting Google gives this product access to the person's Search Console account. Verifying proves to Google that the person owns a particular site. Anybody whose site is already in their Search Console has done the second thing already, and the audit already finds such a property and reads search data from it. The verification flow never looked. It asked for a pull request to prove what Google already knew.

There was also a matching fault under the second question. A property was matched to a site by exact host, so a site added as `example.com` whose property was verified as `www.example.com` was reported as having none.

## Decision

**1. The worker writes why it failed, on the site.** `sites.gsc_verification_error` holds the reason for the last failed attempt. It is cleared when a new attempt is accepted and when one succeeds.

**2. The reason is always in our own words.** `verificationFailure` maps each failure to a sentence saying what happened and what to do. Google's and GitHub's error bodies are never shown: they can carry tokens and repository contents. The fallback sentence says that it is being retried and, if it persists, that the fault is ours.

**3. A refused grant is recorded on the connection.** `oauth_credentials.needs_reconnect_at` is set the first time Google answers `invalid_grant`, and cleared when Google next grants a token or the person connects again. `GET /connections` reports `needsReconnect`. Only a refusal of the grant sets it: a timeout or a 500 says nothing about the connection.

**4. One function gets a Google token.** `googleAccessToken` replaces three hand-written copies of read, decrypt and refresh, so the refusal is recorded wherever it is met: verifying, confirming, or measuring search in an audit.

**5. A request is refused at once when the grant is known to be dead.** `POST /sites/:id/verify` answers 409 with the reason, where it used to accept the request and let a worker find out minutes later.

**6. Verification looks before it asks.** The worker lists the account's Search Console properties first. If a verified one covers the site, the site is marked verified with that property and no pull request is opened.

**7. `www.` and the bare host are one site** when matching a property. The host as typed is preferred, then its twin.

**8. The button answers in place.** It is a client component that shows a refusal beside itself in the API's words, and on success says what will happen, how long it takes, and that the result appears on the same row.

## Consequences

- **The commonest cause is an operator setting, and the page now says so.** A Google OAuth client left in "Testing" issues refresh tokens that expire after seven days. Every account connected through it will need reconnecting weekly until the client is published in Google Cloud. The settings page names this as one of the two reasons.
- **"Verified" can now mean two things**: Google confirmed a tag this product added, or Google already listed the property as verified for this account. Both are Google's statement of ownership. The stored property says which form it took.
- **A site verified through a different Google account is not found**, and gets the pull request. That is correct: this account cannot read that property.
- **The row can show a stale reason for a few minutes.** The queue retries a failed job, and each retry rewrites the reason. A retry that succeeds clears it.
- **A pull request is still needed for a site Google has never seen.** Nothing here removes the feature. It removes the cases where it was asked for and was not needed.
