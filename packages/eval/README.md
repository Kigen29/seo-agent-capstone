# @seo/eval

Precision, recall and hallucination rate for the finding engine, measured against pages a human
labelled by reading them.

```
pnpm --filter @seo/eval build && pnpm --filter @seo/eval eval
```

## Why a golden dataset when the rules already have unit tests

A rule's unit test uses a fixture written for that rule, by the person who wrote the rule, on the
same afternoon. It proves the rule does what its author meant. It cannot tell you whether the
author meant the right thing, and it never contains the case nobody thought of, because a fixture
is a thing somebody thought of.

A golden case is a real site with everything on it at once, including the parts no rule was written
for. It is the only place a false positive can appear, because a fixture has nothing on it but the
thing under test.

## The rule that keeps the number honest

> **Never label from engine output. Use engine output only as a reason to go and look.**

A dataset labelled by the system it grades scores 1.0 forever and measures nothing. So:

1. Capture the bytes (`capture.ts`). It fetches and stops; it writes no labels, on purpose.
2. Read the stored HTML. Grep it. Open it. Write a label with a `why` that says what you saw.
3. Run the harness.
4. For every unexpected claim, **go back to the bytes**. Either it is real and your labels had a
   hole, or it is a false positive. Both are findings. Deciding by looking at what the engine said
   is the one move that invalidates everything.

Step 4 is where the value is, and it is not automatable.

## What happened the first time this ran

`rangau-tiles`, four real pages, labelled by grepping for `<h1`, `rel=canonical` and `<title>`:

| | first run | after re-inspection |
|---|---|---|
| recall | 1.000 | 1.000 |
| precision | 0.696 | 1.000 |
| hallucinations | 0 | 0 |

Seven unexpected claims. All seven turned out to be **holes in the labels, not engine errors**:

- `AGENT-002` fired on all four pages and I had never checked that rule. Grepping for `<main`
  returned zero matches on every page, so it was right and I had simply not looked.
- `AGENT-001` fired on all four pages where I had labelled only the seed. A missing site-wide file
  is a fact about every page an agent might land on, and the claim unit here is `(rule, url)`.

Both labels were corrected **after** verifying against the bytes, which is step 4 working as
designed rather than a breach of the rule above.

**Do not read 1.000 as a good score.** One case, and a labeller who reconciled with the engine on a
second pass, produces a perfect number almost by construction. The figure only starts meaning
something across many independently captured cases, which is why the dataset is the work.

## `checkedAndClear`

Rules the labeller checked and found did *not* apply. Without it a case is unfalsifiable in one
direction: an unlabelled rule is indistinguishable from a rule nobody looked at, so any false
positive can be waved away as "we just did not label that one". The `AGENT-002` gap above is
exactly what this field exists to make visible.

## Known limitations

- **No JavaScript.** A captured case stores served HTML, so `preJsHtml` and `renderedHtml` are the
  same string and TECH-018 (renders nothing until JavaScript runs) can never fire. A case may still
  label it; the false negative is honest. Storing a rendered snapshot alongside the raw bytes is
  the obvious next extension.
- **Labels read through the same parser.** Convenient, but `extractPage` is the product's own code.
  Every label in `rangau-tiles` was therefore re-verified by grepping the raw HTML directly.
- **One case.** Against the ~50 pages the story asks for, this is four. The runner is done; the
  dataset is the remaining work, and padding it with invented pages would produce precisely the
  number nobody should trust.

## Judge independence

`checkJudgeIndependence` compares `LLM_JUDGE` against `LLM_SMART` by **provider family, across the
whole fallback chain**, not by model id and not just at the head. Heads that differ while the
chains overlap is the failure that survives review: it holds until the primary returns a 429, and
then a family quietly starts grading itself, in the flattering direction, which is the direction
nobody investigates.
