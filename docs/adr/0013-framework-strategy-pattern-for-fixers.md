# ADR-0013: Framework-strategy pattern for fixers

**Status:** Accepted
**Date:** 2026-07-19

## Context

The same finding needs a different diff in a different repository. "Add a meta tag to the head" is one file in a Next.js App Router `layout.tsx`, a different file in a Vue single-page app's `index.html`, a `header.php` in WordPress, a `baseof.html` in Hugo, and a bare `index.html` in a hand-written static site. The framework enum already lists fourteen stacks.

Writing one fixer per rule per framework is fourteen times the code, fourteen times the tests, and a combinatorial mess that guarantees most cells are untested. Writing a fixer that inspects the rendered page to guess the framework is the ADR-0001 mistake wearing a different hat: the rendered HTML tells you it is "probably React", not that it is Next.js App Router with the metadata API, which is the fact that turns "add a tag" into a diff in the right file.

## Decision

**Detect the framework from the repository, then dispatch on a small set of strategy families rather than on the framework itself.** The classic Strategy pattern, with the number of strategies chosen to make "support every stack" tractable.

In `packages/fixers`:

- `detectFramework(read)` reads a handful of known files (dependencies in `package.json`, config files such as `next.config`, `astro.config`, `angular.json`, and stack signatures like `wp-config.php`, `Gemfile`, `manage.py`). It reads the repository, never the rendered page, and never the whole tree. Its contract is a single `read(path)` closure, so it is a pure function testable against an in-memory map.
- Each of the fourteen frameworks maps to one of **six head-injection strategy families**: `framework-head` (Next, Nuxt, Astro, SvelteKit, Remix, Gatsby), `spa-index` (React, Vue, Angular), `template-hook` (WordPress), `static-layout` (Hugo, Jekyll), `server-template` (Django, Rails), and `universal`. A fixer implements one approach per family, not one per framework.
- Each family carries an ordered list of the files where its head conventionally lives. The head injector tries them in order, inserts before the first real `</head>` it finds, and returns `null` if none has one.
- **`unknown` is a supported outcome, not a failure.** An unrecognised repository resolves to the `universal` strategy, which edits a root HTML document directly. Detection never crashes; the worst case is the honest fallback.

The canonical, noindex, and content fixers all reuse this one detection-and-strategy machinery, and the Search Console verification vertical injects its meta tag through exactly the same path.

## Consequences

### Good

- One fixer serves every stack in its family. Adding a fixer means writing one transform per family plus the universal fallback, not fourteen near-duplicates.
- Detection is a pure function of repository files, unit tested per framework against fixtures, with no clone and no network.
- The advantage no dashboard competitor has is made concrete: because we read the repo, we know it is Next.js App Router and edit the right file, rather than guessing from the HTML.
- New frameworks slot into an existing family by adding an enum value and a head-file path, usually with no new fixer logic.

### Bad

- The six families are a lossy summary of fourteen stacks. A framework with an unusual head location that is not in its family's file list falls through to `null`, and we say honestly which stacks are proven and which fall back, rather than pretending uniform depth.
- The head-file lists are maintained by hand and will drift as frameworks change their conventions. Accepted: a wrong path yields `null`, not a broken file.

### Neutral

- The strategy families are grouped by "how the framework exposes its document head", which is the axis that actually determines the fix, rather than by language or popularity. That grouping is the design insight, and it is why six is enough.

## Alternatives considered

### One fixer per framework per rule

Rejected. Fourteen frameworks times a growing rule set is a combinatorial explosion that guarantees most combinations are written once and tested never. The strategy family is the abstraction that collapses the framework axis.

### Detect the framework from the rendered page

Rejected, as the write-side form of ADR-0001. The rendered HTML cannot distinguish Next.js App Router from Pages Router, or a Vue SPA from a Nuxt app, and those distinctions are exactly what decide which file to edit. The repository knows; the page only guesses.

### Clone the whole repository and search it

Rejected for this sprint (and noted as out of scope in the sprint backlog). Reading a handful of files through the Contents API is enough to detect the framework and locate a head, needs no working tree, and keeps the fixer a pure function of `read(path)`. A full clone is what per-route content fixes will eventually need, and it is a deliberate future step, not a default.
