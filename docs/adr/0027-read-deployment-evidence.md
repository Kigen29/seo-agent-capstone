# ADR-0027: Read repository deployment evidence through the GitHub App

Status: accepted, 2026-10-04. Extends ADR-0002's minimum permission set; does not replace the GitHub App architecture.

## Context

Production verification reads GitHub deployment records and statuses to establish which commit was released to a site's exact origin. ADR-0002 listed contents, pull requests, metadata, and checks permissions, but omitted deployment read access. The production worker received `Resource not accessible by integration`; the queue failed without recording an actionable finding explanation.

## Decision

The Rankwright GitHub App additionally requests repository **Deployments: Read** permission. Existing installations must approve the updated permission before the reader can access deployment evidence. The App does not require Deployments write permission to verify fixes.

The optional reporting action runs in the site owner's trusted release pipeline using a separate repository-scoped token with **Deployments: Write**. This writer attests to the release; Rankwright reads it and checks commit ancestry and the actual finding. No reporting token is stored in Rankwright.

Denied or unavailable evidence remains inconclusive. The worker persists a safe access or availability explanation on the merged finding and retries; raw provider bodies and credentials are not user-facing error messages. A 403 can also indicate rate limiting, so it is not definitive proof of one missing permission.

## Consequences

App owners must update the permission and installation owners must approve it. This is external configuration, not something a repository commit silently grants. Deployments read is narrower than granting deployment write access to the agent. Provider-specific current-assignment integrations remain optional and retain their existing precedence.

Evidence: production worker run 37200093961, issue #269. The configuration gate remains open until approved access and a fresh verification run are observed.
