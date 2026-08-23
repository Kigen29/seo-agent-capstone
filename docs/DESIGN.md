# DESIGN.md — Classical

The design system this product is built in. Read it before generating any UI for this repository.

It is written in the format popularised by Google Stitch and collected in
[awesome-design-md](https://github.com/VoltAgent/awesome-design-md): a plain-text design system an
agent reads before it writes a component. It exists here for a specific reason. Skills that
generate UI from a brief or an image will otherwise produce competent, generic, modern SaaS —
Inter, a violet-500 primary, 8px radii, three cards in a row. That look is not wrong; it is simply
not this product, and dropping another brand's DESIGN.md into this repo would leave us with two
design languages in one app.

**When these instructions and a generated mockup disagree, these instructions win.**

---

## The idea

An editorial, printed feel: serif type, warm paper, gold used sparingly. The product's argument is
that it tells you the truth about your site — including when it does not know something — and the
interface is meant to read like a well-set report rather than a dashboard competing for attention.

Restraint is the house style. Colour carries meaning and nothing else.

## Palette

Light is the base; every token has a dark counterpart under `prefers-color-scheme: dark` and a
`[data-theme]` override, because the theme toggle must win in both directions.

| Token | Light | Role |
|---|---|---|
| `--color-bg` | `#f3f2f2` | Page. Warm off-white, never `#fff` |
| `--color-surface` | `#eae9e9` | Recessed areas |
| `--color-raised` | `#f8f7f7` | Cards, the thing you read from |
| `--color-text` | `#201f1d` | Body. Warm near-black, never `#000` |
| `--color-accent` | `#b68235` | Gold. Links, focus, one primary action per view |

Status colours come in a triplet (`--color-x`, `--color-x-bg`, `--color-x-text`) so a tag is legible
on its own tint: `success` green, `warning` amber, `danger` red, `info` slate.

**Never introduce a hex value in a component.** Every colour is a token, because dark mode is
derived from them and a literal is a light-mode-only bug waiting to be reported.

## Type

- Headings: `--font-heading`, Cormorant Garamond. Weight **400** — a serif display face at 600 looks
  shouty and cheap.
- Body: `--font-body`, Lora.
- Numbers and code: `--font-mono`.
- `--text-display` is `clamp()`d, so the hero scales without breakpoints.

Numeric columns take `.tnum` (`font-variant-numeric: tabular-nums`) so figures line up down a
column. This product is mostly tables of numbers; without it they wobble.

## Space, shape, depth

- Spacing is `--space-*` off a 4px base. Do not hand-roll pixel margins.
- Radii are **small**: 2/4/7/12px. Nothing here is a pill. A 16px radius reads as a different product.
- Three shadows only, `--shadow-sm|md|lg`, all warm. Cards use `elev-sm`; do not stack elevation.

## Components that already exist

Use these before writing anything new. They live in `apps/web/components/` and `classical.css`.

| Need | Use |
|---|---|
| A panel | `.card` + `.elev-sm`, with `.card-kicker` for the label |
| A number with a label | `<Stat>` inside `<StatRow>` |
| Page title and intro | `<PageHeader kicker title description>` |
| Nothing to show | `<EmptyState figure title action>` |
| A message | `<Note tone="ok\|warn\|error">` |
| Severity | `<SeverityBadge>` — never a raw coloured span |
| A status chip | `.tag` + `.tag-neutral\|outline\|accent\|success\|critical\|low` |
| Paging | `<Pagination>` |
| A form button | `<SubmitButton pendingLabel>` |
| Loading | `.skeleton`, and a `loading.tsx` for the route |

`.card` is a flex column and its default `align-items: stretch` makes every child full width. A
button inside a card needs its width constrained or it becomes a full-width bar. This has caused
four separate visual bugs; check it every time.

## Layout

- `.wrap` for a page, `.wrap-narrow` for a reading column.
- Do layout in utilities. **A hand-written component class will lose a specificity fight with a
  Tailwind utility**: `.classical .nav` is (0,2,0) and `md:hidden` is (0,1,0), so the utility loses
  regardless of the media query. That one shipped.
- Flex children need `min-w-0` before text can truncate.
- Wide tables scroll inside `.table-scroll`; the page body never scrolls sideways.

## Writing

The copy is part of the design and follows the same restraint.

- Sentence case. Plain words. Active voice.
- **No em dashes.** Commas, semicolons, or a shorter sentence.
- Say the number and its unit. "Cited in 2 of 6 checks, across 3 days", not "low visibility".
- A kicker is a category, not a sentence: "Findings", not "Your findings are here".
- Buttons name the action: "Open a pull request", not "Submit".

## The rule that outranks the rest

**An unmeasured thing renders its reason, never a zero.**

Every axis can be honestly unmeasured, and the product's whole argument rests on the difference
between "we looked and found none" and "we did not look". A dashboard reading `0 referring domains`
for a site with no backlink index configured is not a cosmetic bug; it is the product lying. Render
the coverage note, or a dash, and say why.

Every screen therefore needs four states, not two: loading, empty, **unmeasured**, and populated.

## Accessibility

`web-design-guidelines` is installed as a skill and is the checklist; run it over any UI diff. The
ones this codebase gets wrong most often:

- Icon-only buttons need `aria-label`.
- `:focus-visible` rings, never a removed outline. `--color-focus` exists for this.
- Semantic elements: `<button>` for actions, `<Link>` for navigation, never a `div` with `onClick`.
- `<img>` needs explicit `width` and `height`.
- Respect `prefers-reduced-motion`.
- Filters, tabs and paging belong in the URL, so a view can be linked and restored.
