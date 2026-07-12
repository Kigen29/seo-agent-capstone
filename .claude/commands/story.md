---
description: Turn a feature idea into a user story with acceptance criteria and tasks
argument-hint: <feature idea>
allowed-tools: Read, Write, Glob
---

Turn this into a proper agile user story: $1

Format:
- **Story:** As a <role>, I want <capability>, so that <outcome>
- **Acceptance criteria:** Given/When/Then, at least 3
- **Tasks:** the actual engineering breakdown, each 4 hours or less
- **Definition of done:** tests written, CI green, ADR written if an architectural decision was made, docs updated
- **Falsification:** how would we know this feature failed in production?

Append it to `docs/sprint-1-backlog.md` under the right epic. Do not invent an epic that does not exist.
