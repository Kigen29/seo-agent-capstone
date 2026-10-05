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

## What happened the second time, at fifty pages

Two more real sites were captured on 2026-10-05, both single-page apps, with a browser so the
rendered DOM is stored beside the served HTML: `heartbeest-safaris` (24 pages) and `solian-girls`
(22 pages). With `rangau-tiles` that is 50 pages and 232 claims. They were labelled from the stored
bytes with plain regular expressions (not `extractPage`), before the harness was run.

| | first run | after going back to the bytes |
|---|---|---|
| precision | 91.4% | 100.0% |
| recall | 87.8% | 97.9% |
| hallucinations | 0 | 0 |

This time the disagreements went **both ways**, which is what makes the number worth more than the
first one. Each was settled by reading the bytes again, never by reading the engine's output.

**The engine was wrong, four times, and each is now fixed with a regression test:**

- It reported that a site **had** an llms.txt when it did not. A single-page app answers
  `/llms.txt` with its HTML shell and a 200, and any non-empty 200 was accepted.
- It proposed, as the contents of a generated llms.txt, **twenty pages that answer 404**.
- It called a sitemap URL that answers 404 an **orphan**, and advised linking to it.
- It called a 16-word **login form** thin content, and `/contactus` too (the exclusion list knew
  `/contact` and `/contact-us`).

**The labels were wrong, four times:**

- `/reviews` really is thin: 94 words, nearly all of them menu and footer. My count was 104
  because it included the `<title>`.
- The four `rangau-tiles` pages share a 124-character title and one description; those rules did
  not exist when the case was first labelled.
- One URL I labelled as a broken link from the homepage is in the sitemap and is not linked.
- I cleared LOCAL-001 on a school with a phone number, an address and no LocalBusiness markup.
  The claim as the rule states it is true.

**Five misses remain, on purpose.** TECH-018 will not judge a page with fewer than fifty rendered
words. On a site where every route is an empty shell that is still true of the 404 page and the
login form, so they are labelled and they are missed. Unlabelling them would make recall 100% and
the dataset a little less honest.

A site-wide fact is now scored once (`SITE_LEVEL_RULES` in `metrics.ts`). A missing llms.txt used
to count once per page the rule happened to list, so the same fact weighed four claims on one site
and ten on another.

`test/dataset.test.ts` pins all of this: any claim nobody has checked, or any miss beyond the known
five, fails CI.

## Known limitations

- **Three sites, all small, all from one country, two of them single-page apps.** Fifty pages is
  the number the story asked for and is still a narrow sample. The cases a parser has never seen
  are on a WordPress shop, a Shopify store, a site with hreflang, a site with ten thousand pages.
- **One labeller, who also wrote several of the rules.** The labels were made before the run and
  from an independent reading of the bytes, but the same head chose what to look for.
- **Labels are a second pass of regular expressions, not a second person.** Word counts in
  particular differ by what is counted as visible text, which is how `/reviews` was mislabelled.
- **What a live crawl measures is absent.** Redirects, outbound links, phone-width renders and
  image weights are not in a stored case, so TECH-004 on redirecting sitemap URLs, TECH-008 to
  TECH-010 across hosts, and TECH-031 to TECH-034 cannot be graded here.
- **A rendered snapshot is one moment.** It was taken after network idle; a page that fills in
  later would be captured part-rendered.

## Judge independence

`checkJudgeIndependence` compares `LLM_JUDGE` against `LLM_SMART` by **provider family, across the
whole fallback chain**, not by model id and not just at the head. Heads that differ while the
chains overlap is the failure that survives review: it holds until the primary returns a 429, and
then a family quietly starts grading itself, in the flattering direction, which is the direction
nobody investigates.
