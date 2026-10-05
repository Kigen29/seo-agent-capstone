# ADR-0030: The agent reads the repository and proposes the fix

Status: accepted, 2026-10-05. Supersedes the part of ADR-0011 that limited a model to writing one string.

## Context

The product's promise is a pull request. By October the rule engine had 44 rules and the fixer registry could end in a pull request for eleven of them. An audit of a real site returned dozens of findings and a Fix button on a handful, with the rest labelled "Needs you". That label was true and it was the opposite of the positioning: a list handed to a person who usually cannot write code.

ADR-0011 is the reason the number was eleven. It required every fix to be a pure function that locates structure and transforms it, and it rejected "ask the model to rewrite this file" outright. That decision was right about the danger and too narrow about the remedy. A hand-written fixer has to know in advance where each framework keeps each thing. A missing H1 lives in a different file, in a different shape, in every repository. Writing one fixer per rule per framework does not converge, and what it cannot reach falls to the customer.

The danger ADR-0011 named has not gone away: a model that edits a client's repository can reformat a file, delete unrelated content, invent a convention, or touch something nobody asked about. Any design that lets a model write has to answer each of those, and it has to answer a new one: a repository contains secrets, and a prompt is a place secrets leak.

## Decision

**A second kind of fixer, used last.** The worker tries the deterministic registry first, then the meta-description writer, and only if neither applies asks the agent. A finding a parser can fix is still fixed by a parser.

**The rule engine still detects (ADR-0001).** The agent is never asked whether there is a problem. It is given a finding a deterministic rule produced, with its evidence and its falsification condition, and asked for the change that would make that rule pass.

**Which findings.** Thirteen rules are marked agent-fixable: TECH-006, 011, 019, 020, 023, 024, 025, 026, 027, 028, 032, AGENT-002 and AGENT-003. Each is a change to markup or metadata whose correct form is determined by the finding and the page. Three that look similar are deliberately left out: TECH-001 (robots and sitemap disagree, and which one is right is the owner's call), TECH-016 (a redirect needs a destination to be chosen) and AGENT-004 (alt text describes an image the agent cannot see). `fixable` stays a promise (ADR-0022): a rule is on the list only if a pull request is the expected result.

**How it reads the repository.** The provider lists the default branch's file tree in one call. A deterministic selector then chooses what the model sees:

- It scores every path against the finding: shared layout and head files, files named for SEO concerns, files matching the affected URLs' path segments, and the files a given rule is usually fixed in.
- It reads the best-scoring candidates and promotes any that contain the finding's own evidence, such as the duplicated title text or the canonical URL.
- It stops at 14 files and 70,000 characters. The model also receives the paths of other files it may ask for, once.

Selection is code, not a model, so it is testable, costs nothing, and behaves the same on every run.

**What it will not read.** Environment files, anything under `.github/`, lockfiles, key and certificate files, database migrations, tests, tool configuration and build output are refused by path before any content is fetched. A file that passes the path check and still contains something shaped like a credential is withheld, and the prompt says only that a file was withheld. This matters in practice: one of the two real repositories this was built against has a `.env` committed.

**What the model returns.** A structured object (ADR-0005, never free text): a decision of `fix`, `need_files` or `cannot_fix`; a list of edits, each a path, an exact string to find and its replacement; a list of new files; the expected effect; and a rollback note. It does not return whole files. An edit that names text is small by construction and reads as a diff.

**What is checked before a pull request exists.** The proposal is applied in memory and rejected if any of these hold:

- it edits a file the model was not shown, or a refused path;
- a `find` string does not occur exactly once in its file;
- it touches more than 8 files, makes more than 30 edits, or adds more than 30,000 characters;
- it deletes more than half of any file;
- it introduces a hostname that is not the site's own, not already in the files shown, and not schema.org;
- it changes nothing.

Em dashes are removed from anything it wrote. A rejected proposal opens nothing; the finding stays open and carries the reason in words.

**Cost.** One `smart` call per finding, and a second only when the model asked for more files. Never one per page.

**Saying no.** `cannot_fix` is a first-class answer. A model that cannot find where a canonical comes from should say so, and what it says is shown on the finding and kept in the fix history. That is more useful to the owner than "Needs you" and far more useful than a confident wrong diff.

**The human still merges.** Nothing here changes the second law: a branch named `seo-agent/<finding-id>-<slug>`, a pull request with the finding, evidence, expected effect, falsification condition and rollback, and a person who reads it. After the merge the same verifier re-runs the same deterministic rule against production, so a plausible fix that did not work is caught by the check that raised the finding.

## Consequences

- Twenty-four of the 44 rules can now end in a pull request instead of eleven. The findings that still cannot are no longer labelled "Needs you": each says which of four things is true (outside your code, your decision, needs your content, bigger than a patch) and why.
- The agent's quality depends on the model behind the `smart` role. A weaker model declines more often; the validator means it cannot do worse than decline.
- The selector is heuristic. In a repository laid out unlike anything it scores for, the right file may not be among the fourteen, and the outcome is a declined fix with a reason, not a wrong one.
- One extra GitHub API call (the tree) per agent fix. A tree GitHub truncates is treated as a partial list, not an error.
- Private source code is sent to the configured model provider. That is inherent in the feature and is disclosed where the repository is connected.
- ADR-0011's rule that a fixer never invents a location still holds for the registry. For the agent it becomes: it may only edit text it was shown, and the edit must match exactly once.

## Alternatives considered

**More hand-written fixers.** Kept for everything a parser can do reliably, and still preferred when one applies. Rejected as the only route because coverage grows by one rule and one framework at a time.

**Give the model tools and let it explore.** A loop that lists, reads and edits is how a coding agent works and would find more. Rejected for now on cost and on control: the free-tier model chain has tight rate limits, a loop makes an unbounded number of calls, and every file a model chooses to open is a file that has to pass the secrets check at a point we do not control as tightly. One bounded request with one optional follow-up gets most of the value.

**Let the model return whole files.** Simpler to apply. Rejected because it is exactly the failure ADR-0011 described: unrelated reformatting and silent deletion that a reviewer has to hunt for.

## Evidence

`packages/agent/test/repo-context.test.ts` covers what is refused, what is withheld and what is selected. `packages/agent/test/repo-fix.test.ts` covers every rejection in the validator and snapshot-tests the prompt, so a change to it fails CI. `apps/api/test/agent-fix.integration.test.ts` runs the real worker against a real database with a fake repository and a fake model: a good proposal becomes a pull request containing exactly the edited file, an environment file never reaches the prompt, and each kind of refusal lands on the finding in words.

What that evidence does not cover: no test calls a real model. The first proof of the model half is a Fix click in production, and the merge rate and revert rate of agent pull requests are the measures to watch from there.
