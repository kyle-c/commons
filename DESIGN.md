# Commons — Design System

*Codified from the shipped product (design-review audit, 2026-07-23). This is the
baseline every new surface is measured against. Change it deliberately, not by drift.
Agents: deviations from this file are design bugs even when the code works.*

## Identity

Brand: **Unified Craft** (2026-07-26) — sand and paper warmth grounded by moss and
bronze depth; one palette that flexes across both modes. Still a dense, keyboard-driven
professional tool — Figma/Linear-adjacent, macOS-native. Commons is chrome around the
user's *product*; the product is the hero. The UI should recede: low-contrast warm
surfaces, quiet borders, color reserved for meaning.

Dark mode (default) is deep warm charcoal with a moss undertone; light mode is sand
and paper. Light mode is a first-class token set (`data-theme="light"`), never a
special case.

## Typography

- **Stack:** `-apple-system, "system-ui", "SF Pro Text", Inter, sans-serif` — the native
  stack is an intentional choice for a macOS tool, not a placeholder.
- **Display serif** (`--font-display`: Iowan Old Style/Palatino stack) for editorial
  display moments only — page titles like the home "Projects" h1. The tool itself
  stays sans; the serif never appears in controls, labels, or body copy.
- **Scale:** body 13px (`--text-sm`), captions/hints 11-12px (`--text-xs`), section
  headers 14-16px (`--text-md`), page titles 20px/600. Pro-tool density; never below 11px.
- **Weights:** 400 body, 500 emphasis, 600 headings/names. Two weights per surface max.
- Hints and secondary text use `--text-tertiary`/`--text-secondary`, never opacity hacks.

## Color

- **Tokens only.** Every color is a `theme.css` variable; hardcoded hex in components is
  a bug. Translucency via `color-mix(in srgb, var(--x) N%, transparent)`.
- **Budget:** ~12 rendered colors per surface (audit measured 11 — hold that line).
- **Semantic:** `--accent` (muted teal — interactive/brand, the palette's one cool note),
  `--success`, `--danger` — used for meaning, never decoration. Bronze (`--comment`) is
  reserved for open-thread/comment affordances.
- Project card covers are the one expressive surface: brand-color gradients mined from
  the repo, name-hash fallback otherwise. Gradients appear nowhere else.

## Density & geometry

- Controls are 28px tall; titlebar 44px; panel headers ~44px. This is a desktop mouse +
  keyboard tool — do not inflate to touch sizes, do not shrink below 26px.
- Radius scale: `--radius-sm` inputs/chips, `--radius-md` cards/rows, `--radius-lg`
  panels/popovers, `999px` pills. Nested radius ≤ parent radius.
- Spacing rhythm: 4/6/8/10/12/14/16/20. Related things sit closer than unrelated things.

## Surfaces & patterns

- **Titlebar:** the command strip. Text-label ghost buttons; the breadcrumb is the only
  flexible child (ellipsizes; "Projects /" prefix drops below 1240px). Controls never
  shrink or wrap. New titlebar items must justify their permanent cost.
- **Popovers** (`titlebar-popover`): anchored top-right, 340px default. Settings forms use
  `popover-form` (stacked: bold label → one-line hint → full-width input → inline
  validation → right-aligned actions). Never inline labels beside inputs.
- **Side panels** (agent, user tests, threads): fixed, `--radius-lg`, own scroll; close
  via ✕ and their shortcut.
- **Pills/chips** (update ready, heatmap active, catch-up): bottom- or top-centered,
  one line, one action, dismissible. For ambient state only — never primary workflow.
- **Badges:** tiny rounded rects; bronze = open threads, green = live, accent = active.

## Copy voice

The strongest part of the system — protect it:

- Buttons say what they do: "Use Kyle · kyle@…", "Get this project", "Restart to update".
  Never "OK", "Submit", "Continue".
- Hints anticipate the user's next confusion and name the fix: "push failed — ask the
  host to check git credentials". Errors always include the way out.
- No happy talk, no welcome paragraphs, no instructions longer than one sentence.
- Designer vocabulary over git vocabulary: draft → share → ship. Route/branch internals
  stay in tooltips.
- Keyboard hints ride inline as `kbd` glyphs; every shortcut description feeds the `?`
  cheat sheet automatically.

## Interaction model (layers)

Three surface layers, strict rules — never two siblings of the same layer at once:

1. **Popovers** (inbox, team, workspaces, setup, share): transient, anchored to their
   trigger, dismissed by click-outside or Esc. Built from the popover kit
   (`components/popover.tsx`): section labels, identity rows with quiet trailing
   actions, and `RevealField` inputs that exist only while in use — a menu reads as
   content, not a stack of forms.
2. **Side panels** (Agent, Narrate): one exclusive slot; opening one closes the other.
   Panels anchor to the edge their trigger lives on (right cluster → slide from right),
   so a panel always appears under its button.
3. **Modals** (compare, welcome): scrim + card, one at a time, Esc closes.

## Keyboard-first

Every new surface registers a shortcut in `lib/shortcuts.ts` with a description
(CLAUDE.md rule). Current map: `C` comment · `A` agent · `U` user tests · `⌘T` team ·
`⌘I` inbox · `⌘L` theme · `⌘±/⌘0` zoom · `?` cheat sheet · `Esc` dismiss.

## Motion

Functional and minimal: state transitions and perceived speed only, nothing decorative.
If a section feels empty, it needs better content, not animation.

The system is two durations and one curve, defined once in `styles.css`:
`--dur-fast` (120ms, hover/press feedback), `--dur-med` (200ms, entrances and
crossfades), `--ease-out`. Shared keyframes: `rise-in` (lists, cards, messages),
`pop-in` (popovers, banners, the palette), `fade-in` (overlays), `panel-in-left/right`
(side panels enter from their own edge), `shimmer` (skeletons). Do not invent new
durations or curves per component.

Rules of thumb:
- Feedback is instant-feeling: press states (`.btn:active` scale 0.97) and hovers use
  `--dur-fast`; anything slower reads as lag, the opposite of the goal.
- Entrances only; exits are instant. Users wait for arrivals, never for departures.
- Never animate layout the user is actively manipulating (canvas pan/zoom, frame drag,
  live cursors) — direct manipulation must track the hand 1:1. Commanded moves (⌘±,
  Fit) are the exception: they glide (~200ms rAF tween) to preserve spatial context,
  land instantly under reduced motion or a hidden window, and any hand input cancels
  the glide mid-flight.
- Optimistic UI over waiting: user-created objects (comment pins) appear the moment
  they're submitted, marked visually in-flight (translucent pulse) until the server
  confirms; on failure they retract and the input returns.
- `prefers-reduced-motion` collapses the entire system to instant (global block at the
  end of `styles.css`); every animation must remain purely an enhancement.

**The two sanctioned exceptions to "no new durations".** Both are moments, not component
states, and both are skipped entirely under reduced motion:

- **The archive send-off** (`lib/celebrate.ts`, 520ms): a card is pulled into a void with
  a synthesized whoosh. Archiving is otherwise the silent disappearance of a card, and
  this gives it a beat. Its shape lives in keyframes sampling `1 - 0.98·u^1.8` rather
  than in a curve, because the first version's steep bezier left four-fifths of the
  movement in the last fifth of the time and read as a snap.
- **The grid reflow** (`lib/flip.ts`, 420ms ease-out): cards FLIP into the gap the
  archived card left instead of appearing in it. Animating only the thing that leaves,
  and not the six things that move, is the same jolt one step later.

Nothing else gets a bespoke duration. If a third exception seems necessary, it probably
belongs in the shared scale instead.

## Perceived speed

The app should feel faster than it is:
- A frame never flashes blank while its iframe boots: the latest snapshot (or a shimmer)
  shows instantly underneath and the live view fades in over it (`.frame-underlay`,
  `.frame-booting`, `iframe.loaded`).
- Query-backed surfaces show skeletons in the shape of their content (`.skeleton`,
  `.skeleton-card`), not text or spinners — shimmer reads as "already working".
- Whole-screen loading text appears only after a 150ms delay (`.center-screen`), so
  fast loads never show a loading state at all.
- Grids and queues stagger their entrance (30ms steps, capped) so screens read as
  assembling instantly rather than popping in as one block.

## Iconography

Text-first in content; chrome controls use the single 16px stroke-icon family in
`components/icons.tsx` (currentColor, 1.8 stroke). No emoji in chrome, no decorative
icons, no icon circles, no illustration. An icon earns its place only as a functional
identifier with a tooltip and aria-label carrying the words.

## Accessibility floor

- Complex/iconic buttons carry `aria-label` (e.g. project cards: "Open {name}").
- Focus styles never removed; inputs get `:focus` accent borders.
- Guest identities (web commenters) render with name + neutral gray everywhere a member
  would show an avatar — a "?" pin is a bug.
- `initials()` strips punctuation; never render raw symbols in avatars.

## The update chip

The app's entire update story is one floating pill (`UpdateChip`): it narrates checking,
downloading, and ready, whether the check came from the menu or the hourly background
loop — "Check for Updates…" answers here, never with a dialog. Ready is the only state
that stays, because it is the only one with an action; informational outcomes (up to
date, couldn't reach the feed, dev build) excuse themselves after five seconds. Quiet
states use `.update-chip.quiet` — even padding, secondary text, no button. One
asymmetry, on purpose: "nothing happened" outcomes only show for checks a person asked
for; the background loop stays silent unless it has a release in hand.

## Async states

Every query-backed surface has a loading state ("Loading tests…") — a blank panel reads
as broken. Empty states are persona-aware and name the action that fills them.

## Web surfaces (share pages, tester harness, reports)

Self-contained inline CSS mirroring the app's dark palette by value (#1a1b17 canvas,
#21221d panels, #2a2b24 borders, #45a898 accent and links, Georgia-stack serif page
headings). Same copy voice. Read-only surfaces say who they're from ("shared from
Commons") and route back via deep link.

The share page is not a printout: it carries the canvas controls people expect from the
app. Pan by drag or wheel, zoom by pinch or the toolbar (with Fit), the same dot grid
with the CSS cursor trail, and a Canvas/Prototype switcher when the project has a
preview link, including the route list and the light/dark appearance flip. Narrate flow
notes and the provenance footer float as overlays rather than pushing the canvas down.

## Marketing surface (trycommons.app)

The only place Commons leads with light mode. Paper (#f3f0e8) and panels (#fbf9f4) under
ink (#26251e), deep teal accent (#1f7a6e) for contrast on paper, serif display at every
heading level. Product imagery is dark, so the page reads calm and the app reads focused,
which is the same figure/ground logic the app uses between chrome and canvas.

Rules that keep it honest: no external fonts, scripts, or images (it renders instantly
and survives any CSP), product visuals are drawn in CSS rather than faked in a mockup
tool, and claims map to shipped behaviour. Motion is one gentle reveal on first sight and
nothing else, disabled under reduced motion.

Structure (premium pass, 2026-08-02): centered hero with a badge and the product shot
staged in a halo → works-with strip (real integrations as text chips, never faked logos)
→ the shift → **who it's for** (designers, engineers, PMs as three `.tier` columns) →
feature rows alternating side to side → steps with serif numerals → access tiers → FAQ →
closing CTA on the app's own dot grid → a real three-column footer. Sections alternate
`.band` with plain so the page has a pulse; a new section reuses the existing `.tier` /
`.card` / `.row` vocabulary rather than adding CSS. One material recipe on every raised
surface (ambient + key shadow + top highlight); rules fade at both ends; the halo is the
page's one gradient flourish and bleeds deliberately, clipped by `overflow-x: clip`
(never `hidden`, which kills the sticky nav). The role section exists because the three
jobs read the same product differently, and a visitor should find their own row before
the feature detail starts.

## Anti-patterns (audit-enforced)

- Gradients outside project covers · icon-in-circle grids · centered-everything ·
  decorative blobs/dividers · happy talk · "OK/Submit" buttons · hardcoded colors ·
  wrapping/clipping bars (degrade like the titlebar instead) · blank loading panels ·
  dev vocabulary in designer-facing labels.
