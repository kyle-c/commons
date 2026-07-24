# Commons — Design System

*Codified from the shipped product (design-review audit, 2026-07-23). This is the
baseline every new surface is measured against. Change it deliberately, not by drift.
Agents: deviations from this file are design bugs even when the code works.*

## Identity

Dark-first, dense, keyboard-driven professional tool — Figma/Linear-adjacent, macOS-native.
Commons is chrome around the user's *product*; the product is the hero. The UI should
recede: low-contrast surfaces, quiet borders, color reserved for meaning.

Light mode is a first-class token set (`data-theme="light"`), never a special case.

## Typography

- **Stack:** `-apple-system, "system-ui", "SF Pro Text", Inter, sans-serif` — the native
  stack is an intentional choice for a macOS tool, not a placeholder. No display font.
- **Scale:** body 13px (`--text-sm`), captions/hints 11-12px (`--text-xs`), section
  headers 14-16px (`--text-md`), page titles 20px/600. Pro-tool density; never below 11px.
- **Weights:** 400 body, 500 emphasis, 600 headings/names. Two weights per surface max.
- Hints and secondary text use `--text-tertiary`/`--text-secondary`, never opacity hacks.

## Color

- **Tokens only.** Every color is a `theme.css` variable; hardcoded hex in components is
  a bug. Translucency via `color-mix(in srgb, var(--x) N%, transparent)`.
- **Budget:** ~12 rendered colors per surface (audit measured 11 — hold that line).
- **Semantic:** `--accent` (interactive/brand), `--success`, `--danger` — used for meaning,
  never decoration. Amber is reserved for open-thread/comment affordances.
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
- **Badges:** tiny rounded rects; amber = open threads, green = live, accent = active.

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

## Keyboard-first

Every new surface registers a shortcut in `lib/shortcuts.ts` with a description
(CLAUDE.md rule). Current map: `C` comment · `A` agent · `U` user tests · `⌘T` team ·
`⌘I` inbox · `⌘L` theme · `⌘±/⌘0` zoom · `?` cheat sheet · `Esc` dismiss.

## Motion

Functional and minimal: state transitions only, nothing decorative. If a section feels
empty, it needs better content, not animation.

## Iconography

Text-first. The few glyphs in use are functional identifiers (⚡ agents, 🧪 tests,
💬 comments, ☾ theme) — do not add decorative icons, icon circles, or illustration.

## Accessibility floor

- Complex/iconic buttons carry `aria-label` (e.g. project cards: "Open {name}").
- Focus styles never removed; inputs get `:focus` accent borders.
- Guest identities (web commenters) render with name + neutral gray everywhere a member
  would show an avatar — a "?" pin is a bug.
- `initials()` strips punctuation; never render raw symbols in avatars.

## Async states

Every query-backed surface has a loading state ("Loading tests…") — a blank panel reads
as broken. Empty states are persona-aware and name the action that fills them.

## Web surfaces (share pages, tester harness, reports)

Self-contained inline CSS mirroring the app's dark palette by value (#101012 canvas,
#18181b panels, #2a2a2f borders, #7c9cf5 links). Same copy voice. Read-only surfaces say
who they're from ("shared from Commons") and route back via deep link.

## Anti-patterns (audit-enforced)

- Gradients outside project covers · icon-in-circle grids · centered-everything ·
  decorative blobs/dividers · happy talk · "OK/Submit" buttons · hardcoded colors ·
  wrapping/clipping bars (degrade like the titlebar instead) · blank loading panels ·
  dev vocabulary in designer-facing labels.
