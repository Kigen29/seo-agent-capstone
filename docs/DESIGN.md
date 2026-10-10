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

An editorial, printed feel: serif type, warm paper, gold used sparingly. The palette and the type
are Classical. The structure (the shell, the surfaces, the shapes of the components) was redrawn
from the Stitch project "Comprehensive UI Redesign", whose own colours and fonts were deliberately
not adopted. The product's argument is
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
- Radii are 4/8/12/16px. Controls (buttons, inputs, nav links) take `--radius-md`; surfaces
  (cards, table frames, wells) take `--radius-lg`.
- Tags are small rectangles with a hairline in their own colour. **The only pill is a live-status
  tag** (`.tag-dot`: an audit's state, a connection), which is led by a dot, so "this is running
  state" has a shape of its own. Buttons stay rectangular. The switch track and the avatar are the
  other two round things, because a square switch does not read as a switch and a circle reads as
  a person.
- Depth is tonal before it is shadow: the sidebar and table headers sit on `--color-surface`,
  cards and table bodies on `--color-raised`, fields on `--color-bg`. Three shadows only,
  `--shadow-sm|md|lg`, all warm; do not stack elevation.

## Components that already exist

Use these before writing anything new. They live in `apps/web/components/`, in `apps/web/lib/format.ts`, and in `classical.css`, which is an index of five files under `app/classical/` (base, controls, surfaces, layout, content) loaded in that order.

| Need | Use |
|---|---|
| A panel | `.card` + `.elev-sm`, with `.card-kicker` for the label |
| A number with a label | `<Stat label value hint tone>` inside `<StatRow>`. Small uppercase label, large serif figure, optional line of context. `tone="accent"` marks the one figure in a row that is in motion |
| A card in a grid of cards | `.card` with a `.card-heading` title and, as its last child, a `.card-foot` row |
| Page title and intro | `<PageHeader kicker title description>` |
| Nothing to show | `<EmptyState figure title action>` |
| A message | `<Note tone="ok\|warn\|error">` |
| A failure from a form or an action | `<ErrorNote error>`, fed by a server action that returns `ActionResult` from `act()` in `lib/action.ts`. Never a hand-written sentence in a `<span>`: the failures are few and the same everywhere, and `toUserError` names each once with what happened and what to do |
| A save that worked | `<SavedNote>`, in the place the error would have been |
| What happened after an action that left the page and came back | `<OutcomeNote outcome>`, with the status looked up by `outcomeFor(table, status)`. The same title-then-detail shape as `<ErrorNote>`. Never index a table with a status from the address directly: `table['constructor']` is a function |
| A term that needs a sentence of explanation | `<InfoHint label>` beside it. Opens on click, tap or Enter; never hover only |
| A labelled input | `<Field id label hint help>`. The hint sits beside the label, not inside it |
| Severity | `<SeverityBadge>` — never a raw coloured span |
| A status chip | `.tag` + `.tag-neutral\|outline\|accent\|success\|critical\|low`. Add `.tag-dot` only for live status |
| A list of records: sites, audits, mentions, keywords, anything with more than one of it | `<DataTable label columns rows>`. Never a hand-drawn `<ul>` of bordered rows and never a bare `<table>`. It pages at ten rows, shows "11 to 20 of 37" in its footer, and draws no footer when everything fits on one page. Cells are passed already rendered, so a server page and a client panel use the same component. Put a page's tables in a `*-tables.tsx` file beside it, so the page file stays what is fetched and what is said when there is nothing |
| A table whose last column is the thing to press | `<DataTable stack>`. On a phone each row becomes a block of labelled lines instead of scrolling sideways |
| Offers to tick: suggested competitors, suggested questions | `<PickTable heading items picked onChange>`. The caller holds the choice, so a tick survives paging, and owns the button that applies it |
| A list filtered and paged on the server, with the page in the address | `.table` inside `.frame > .table-scroll`, with `<Pagination inFrame>` as the `.panel-foot` strip. Only the findings inbox, where a filter has to be linkable |
| A month of days with things on them | `<MonthCalendar label month days today entries>`. A real table, Monday first, whole weeks, today marked with `aria-current="date"`. Drawn from `md` up; on a phone show the same events as a `<DataTable stack>` instead, because a seven-column grid leaves a day fifty pixels. A state on a calendar entry is a mark and a word, never a colour alone |
| A key to the terms a table uses | `<Legend items>` under or over the table. Never a `title` tooltip, which reaches a mouse and nothing else |
| A link to somebody else's page | `<OutboundLink href>`. New tab, says so to a screen reader, carries the mark, and sends `noopener noreferrer nofollow` |
| A date, a site's name, a count with its noun, an answer engine's name | `formatDay`, `formatDayTime`, `hostOf`, `plural`, `engineNames` from `@/lib/format`. Never `toLocaleString()`, which prints a different date on a different machine, and never a second copy of any of these in a page file |
| A rule id beside a title | `.rule-id` |
| Parts of a whole | `.meter` with one `<span>` per part |
| Sidebar or section navigation | `.side-link` with `aria-current="page"`, under a `.side-label` group heading |
| Paging | `<Pagination>` |
| A form button | `<SubmitButton pendingLabel>` |
| Loading | `.skeleton`, and a `loading.tsx` for the route |
| A menu | `<DropdownMenu>` and friends |
| An on/off control | `<Switch>` |
| A profile picture | `<Avatar>` + `<AvatarFallback>`, and `initials()` |
| A form label | `<Label>` |
| A rule between sections | A top border in `--color-divider` on the section that follows |
| A button, or a link that looks like one | `.btn` with `.btn-primary`, `.btn-secondary` or `.btn-ghost`, on a `<button>` or a `<Link>`. `.btn-sm` for a row action |

`.card` is a flex column and its default `align-items: stretch` makes every child full width. A
button inside a card needs its width constrained or it becomes a full-width bar. This has caused
four separate visual bugs; check it every time.

## shadcn, and what we took from it

`components/ui/` holds shadcn-shaped components built on Radix. What was taken is the
**architecture**: a `className` that genuinely overrides through `cn()`, and Radix's keyboard,
focus and ARIA behaviour for the things that are genuinely hard.

A `<Button>` and a `<Separator>` component were copied in at the start and removed in October
2026 with no caller left: every button in the app is the `.btn` class on a real element, which is
one fewer layer between the markup and the stylesheet that decides how it looks.

What was **not** taken is the look. shadcn is copy-in components you own, not a theme you adopt, so
every one of these is restyled onto the tokens above. There is no Inter, no violet primary, no
16px radius and no second palette anywhere in `components/ui/`.

Two rules follow, and they are the ones to hold the line on:

- **A component that has a Classical class uses it.** A button is `.btn .btn-primary`; nothing
  re-declares gold in Tailwind utilities. Primary is a filled gold button with
  `--color-on-accent` text, secondary is a bordered surface, and a view gets one primary. There is still exactly one place that decides
  what a primary button looks like, and it is `classical.css`.
- **Reach for Radix when the behaviour is hard, not when the markup is.** A menu, a switch, a
  dialog and tabs are worth it: roving tabindex, Escape, focus return, `aria-expanded` and
  click-outside are each a thing to forget. A card is not worth it, and `.card` stays as it is.

`components.json` exists so `npx shadcn add` drops a component in the right place with the right
aliases. Anything it generates arrives in the default look and has to be restyled onto the tokens
before it ships.

## Motion

Classical is a still design. Motion is in `app/motion.css` and exists only where, without it,
something happened and the page did not say so.

- **A press is answered.** Every `.btn` scales to 0.97 while it is held, over 120ms. Do not add
  a second pressed style to a button.
- **Name the property.** `transition: all` is not used. Colours ease over 140ms on
  `--ease-out`; nothing takes longer than 300ms.
- **What is done constantly is not animated.** Turning a page of a table, switching a tab and
  sorting a column change at once.
- **Things arrive decelerating and leave faster than they came.** The dialog sheet enters in
  220ms and leaves in 150ms. Nothing eases in, and nothing grows from zero: a panel starts at
  97% and transparent.
- **A popover opens from what was pressed**, not from its own centre. A dialog is centred, and
  rises from the bottom edge on a phone, where it is anchored.
- **Hover is for pointers.** Hover styles sit inside `@media (hover: hover) and (pointer: fine)`,
  so a tap on a touch screen does not leave a row highlighted.
- **Less motion still gets feedback.** Under `prefers-reduced-motion` the fades stay and anything
  that moves or changes size does not.

## Layout

- `.wrap` for a page, `.wrap-narrow` for a reading column. `.wrap` is fluid up to 1600px with a
  32px margin, so tables use the width; prose caps itself with `max-w-[..ch]`.
- The shell is a 260px sidebar on `--color-surface` and the stage beside it. The stage opens with
  `<Topbar>`: where you are, the Search Console connection, and Run audit for the current site.
- **A `.classical` element rule beats any utility on that element**, because `classical.css` is
  unlayered and Tailwind's utilities are in a layer. `m-0` on a `<p>` and `p-0` on a `.card` do
  nothing. Use a `<div>` where a paragraph's margin is in the way, and an inline style for a
  card's padding.
- Do layout in utilities. **A hand-written component class will lose a specificity fight with a
  Tailwind utility**: `.classical .nav` is (0,2,0) and `md:hidden` is (0,1,0), so the utility loses
  regardless of the media query. That one shipped.
- The same fight, in the other direction, has now shipped twice: **`mx-auto` does nothing on a
  `<p>`**. `.classical p` sets a margin at (0,1,1) and beats `.mx-auto` at (0,1,0), so the
  paragraph sits against the left edge of a container whose every other child is centred, and
  nothing warns you. `max-w-*` on the same element applies perfectly, which is what makes it look
  like a centring bug rather than a specificity one. Put the constraint on a wrapping `<div>`.
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
