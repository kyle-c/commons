# Commons — Product Requirements Document

*Reverse-engineered from the implementation, 2026-07-09. `SPEC.md` remains the source of truth for locked decisions; this document describes what Commons does and requires, with per-requirement status. Update it when scope ships or changes.*

**Status legend:** ✅ shipped · 🚧 in progress · 📋 planned

---

## 1. Problem

Design teams that build in code (the "codebase is the design file" workflow) lose the things that made Figma valuable as a *collaboration* surface: a shared canvas everyone can see, comments pinned to the work, prototypes anyone can click, and links that take a teammate to the exact spot under discussion. Meanwhile teams that stay in Figma can't leverage AI coding agents on the real product.

Commons rebuilds Figma's residual collaboration value on top of **both** sources — live code previews and Figma frames — in one shared canvas, and closes the loop by letting comment threads drive coding agents that edit the real codebase.

## 2. Users

Kyle's product design team (~8–12 pilot users): 5 designers, 1 researcher, 1 content designer, several PMs.

- **Designer-engineers** — design in code, run the repo locally, review and steer agent sessions.
- **Designers/researchers/content** — comment, mention, browse prototypes; may not have the repo.
- **PMs** — mostly consume: prototypes, threads, deep links (eventually via the read-only web fallback).

Real multi-user from v1 (accounts, invites, mentions). Explicitly **not** in scope: billing, orgs, permissions tiers, scale work.

## 3. Goals

1. One canvas where live code previews and Figma frames coexist and are commented on identically.
2. Feedback→fix loop measured in minutes: comment thread → agent session → diff lands → frame re-renders.
3. Anyone on the team can reach any project/frame/thread in one click (`commons://` deep links).
4. Keyboard-first, dense, pro-tool feel (Figma/Linear-adjacent dark chrome).

**Non-goals:** replacing Figma's editor; multi-tenant SaaS; non-macOS platforms; frameworks beyond Next.js and Expo getting first-class auto-discovery (manual config is the escape hatch for everything else).

## 4. Requirements

### 4.1 Projects & local repos

| ID | Requirement | Status |
|---|---|---|
| PRJ-1 | Project list (home) shows all team projects with creator, live active users, frame count, open thread count | ✅ |
| PRJ-2 | Add a project by pointing at a local repo; framework (Next.js / Expo) + package manager detected (pnpm/yarn/npm/bun) | ✅ |
| PRJ-3 | Next.js route auto-discovery (app + pages router); route-group segments skipped; dynamic segments surfaced with editable sample params | ✅ |
| PRJ-9 | Expo (React Native) support: expo-router route discovery, `expo start --web` dev server, phone-sized frames (390×844) on the canvas, iPhone default in Prototype view | ✅ |
| PRJ-10 | Discovery self-heals: opening a project with a linked repo but no frames re-runs discovery automatically; "Locate repo" and canvas "Tidy" (section re-layout) also refresh it | ✅ |
| PRJ-11 | Project cards show a generated cover: project name over a gradient of the repo's two most prominent brand colors (mined from its stylesheets at discovery; name-hash fallback pair otherwise) | ✅ |
| PRJ-4 | One dev server per open project, spawned by the Electron main process on a free port, status streamed to the renderer (`stopped/starting/ready/error`) | ✅ |
| PRJ-5 | Teammates without the repo see frames via the project's deployed preview (`previewUrl` + route, set from the titlebar); non-live frames carry a "preview" badge | ✅ |
| PRJ-6 | Projects can be archived | ✅ |
| PRJ-7 | Repo identity is the git remote (auto-detected on add/locate); local working-copy paths are per-user `repoLinks`, so multiple teammates can host the same project on their own machines | ✅ |
| PRJ-8 | Truth lives in git: Commons never syncs source code between machines — it maps who has a working copy and where rendered previews live | ✅ (design principle) |

### 4.2 Canvas

| ID | Requirement | Status |
|---|---|---|
| CAN-1 | Infinite canvas: two-finger pan, pinch/⌘-wheel zoom around cursor (5%–200%), fit-to-content | ✅ |
| CAN-2 | Frames are live localhost iframes of the project's routes; drag by header to re-layout (position synced via Convex) | ✅ |
| CAN-3 | Click-through model: frames are shielded until clicked (Figma-style focus); Esc releases | ✅ |
| CAN-4 | Frame header shows title, route, open-thread count badge | ✅ |
| CAN-5 | Frames re-render automatically when an agent session finishes editing (per-frame iframe reload) | ✅ |
| CAN-6 | Figma frames on the canvas (`kind: "figma"`, rendered via REST API) | 📋 M4 (schema supports, renders placeholder) |
| CAN-7 | Keyboard zoom: ⌘+/⌘− zoom the canvas around its center, ⌘0 fits to content; Electron's chrome-zoom menu roles removed so the keys reach the canvas | ✅ |
| CAN-8 | The canvas organizes itself from code structure: frames cluster into labeled section bands derived from router groups / shared path segments (the structure a designer would draw by hand in Figma, auto-derived); "Tidy" re-applies the derived layout to existing projects | ✅ |
| CAN-9 | Semantic zoom: below 25%, frames show tail-segment labels clamped to their on-screen width (full path on hover) and section labels carry the orientation; detail returns as you zoom in | ✅ |
| CAN-10 | Corner minimap rendered from synced frame geometry for orientation and navigation | ✅ |
| CAN-8 | Auto-sections: frames cluster into labeled canvas regions derived from route structure (router groups like `(tabs)`, else shared first URL segments); labels stay readable at any zoom; regions follow frame drags | ✅ |
| CAN-9 | Semantic zoom: below 25% the canvas swaps unreadable frame headers for large frame-title pills | ✅ |
| CAN-10 | Minimap (bottom-right): schematic frame map with open-thread pins and the current viewport rectangle; click or drag to jump | ✅ |
| CAN-11 | Inferred flow arrows from `Link`/`router.push` analysis (auto flow diagram) | 📋 (rung 5 of the orientation ladder) |

### 4.3 Comments & notifications

| ID | Requirement | Status |
|---|---|---|
| COM-1 | Comment mode (`C`): pin threads to a frame at relative x/y (survive re-layout/re-render) or to the canvas at absolute coords | ✅ |
| COM-2 | Threaded replies in a side panel; resolve/reopen | ✅ |
| COM-3 | @mentions with typeahead; mentioned users get an in-app inbox notification | ✅ |
| COM-4 | Mention emails (Resend) with a deep link to the thread; no-op without API key so local dev works unkeyed | ✅ |
| COM-5 | All comment data syncs live through Convex (multiplayer by default) | ✅ |

### 4.4 Prototype view

| ID | Requirement | Status |
|---|---|---|
| PRO-1 | Full-size, clickable render of the running app in an embedded frame | ✅ |
| PRO-2 | Device-width presets (iPhone 390 / iPad 834 / Desktop 1280 / Fill) + route picker | ✅ |
| PRO-3 | Figma prototype embed for Figma-backed projects | 📋 M4 |
| PRO-4 | "Open in browser" carries the form factor: framed devices (iPhone/iPad presets) open through a local preview-harness page that renders the app at device size with a device chrome; desktop/fill open the raw URL. Harness only frames localhost targets | ✅ |

### 4.5 Identity, team & collaboration

| ID | Requirement | Status |
|---|---|---|
| ID-1 | Google sign-in via system browser (auth-code flow on a Convex HTTP action; app never sees Google credentials; server-generated 128-bit `state` nonce; session token stored on device, validated on launch) | ✅ |
| ID-2 | Sign-in completion via `commons://auth/callback` deep link **or** live Convex status subscription (covers dev builds without protocol registration) | ✅ |
| ID-3 | Invite-gated membership: first sign-in bootstraps the team; after that an email must be a member or hold an invite | ✅ |
| ID-4 | Team popover (⌘T): member list, pending invites, invite-by-email (sends courtesy email), revoke | ✅ |
| ID-5 | Presence: heartbeat while a project is open; active-user avatar stack in the titlebar | ✅ |
| ID-6 | Presence cursors on the canvas: teammates' pointers render live with name tags in their avatar color; positions sync in canvas coordinates (correct across different viewports/zoom), throttled to ~8 writes/s in a dedicated high-churn table so avatar/list queries aren't invalidated | ✅ |
| ID-8 | Presence avatars show Google profile photos (falling back to initials) in the titlebar stack and project cards | ✅ |
| ID-9 | Onboarding: one-time welcome card after first sign-in; `?` opens a shortcuts cheat sheet generated from the live shortcut registry | ✅ |
| ID-10 | Persona-aware empty states: viewers without the repo see "ask ‹holder› to publish a preview" (never repo instructions); repo-holders on preview-less multi-user projects get a dismissible "set preview URL" nudge banner | ✅ |
| ID-11 | Invite email as front door: what-Commons-is + download link + deep link into a specific project after first sign-in | 📋 (needs hosted signed DMG) |
| ID-12 | Private projects: `visibility` team/private with explicit members; enforced across all project-scoped queries (list, frames, threads, presence, cursors, agent sessions, repo holders); creator manages members + visibility via a Sharing popover; add-project offers Team/Private | ✅ |
| ID-13 | On private projects, @mentions are restricted to members — the composer only offers members, and the backend silently drops non-member mentions (no notification, no email) | ✅ |
| ID-14 | Avatars default to the Google profile photo (refreshed each sign-in) with a custom-photo override uploaded to Convex storage; sign-in never clobbers a custom photo; reset-to-Google available from the account menu | ✅ |
| ID-7 | Sign-out; stale local identity self-heals to the sign-in screen | ✅ |

### 4.6 Deep links

| ID | Requirement | Status |
|---|---|---|
| DL-1 | `commons://project/<id>/<view>?frame=…&thread=…` opens Commons to the exact project/view/frame/thread; queued if Commons is still launching | ✅ |
| DL-2 | Copy-link from the titlebar; protocol registered in dev and packaged builds | ✅ |
| DL-3 | Web fallback: same URL serves a read-only browser view for people without Commons installed | 📋 M5 |

### 4.7 Agent sessions (M3)

| ID | Requirement | Status |
|---|---|---|
| AG-1 | Embedded Claude Code sessions run in the Electron main process via the Claude Agent SDK, `cwd` = the project's `repoPath`; renderer talks only through the IPC bridge | ✅ |
| AG-2 | **Adapter interface**: agents implement `AgentAdapter` (`apps/desktop/src/main/agents/adapter.ts`) — one prompt in, normalized event stream + resume token out. Codex CLI (or others) = one new adapter file + registry entry | ✅ |
| AG-3 | "⚡ Agent" on a comment thread builds a self-contained prompt from the thread messages + frame context (route, frame title, pin position as % of page) and starts a session | ✅ |
| AG-4 | Session panel (`A`): live transcript of prompts, agent text, tool calls, results (turns/duration/cost/edited files); multiple sessions as tabs; follow-up prompts continue the same conversation (SDK resume); Stop interrupts | ✅ |
| AG-5 | File edits auto-approved (`acceptEdits`), Bash pre-allowed; edited files tracked and reported per session | ✅ |
| AG-6 | When a session finishes with edits, the targeted frame's iframe reloads (canvas-pinned sessions reload all frames) | ✅ |
| AG-7 | Per-tool permission prompts surfaced in the panel UI | 📋 (no UI yet; modes are pre-set) |
| AG-8 | The host posts the agent's summary (+ changed files) back to the originating thread when a turn succeeds | ✅ |
| AG-9 | Sessions are mirrored into Convex (session doc + ordered event transcript), so the whole team watches live; steering (follow-ups, Stop) stays with the host machine, spectators see who's hosting | ✅ |
| AG-10 | Cloud agent execution: sessions run in a sandbox against a git clone, land as a branch + deploy preview — removes the "host must have the repo" constraint. Mirroring (AG-9) already makes the viewing model executor-agnostic | 📋 |

### 4.8 App chrome

| ID | Requirement | Status |
|---|---|---|
| CHR-1 | Light mode alongside the default dark chrome: full token set in `theme.css`, titlebar toggle cycling dark → light → system (follows macOS), ⌘L toggles; preference persists per machine | ✅ |

### 4.9 Figma bridge (M4) — 📋 planned

- Figma → code: point at a Figma frame; an agent session scaffolds/updates the code project from it (REST/MCP + AG-* infrastructure).
- Code → Figma: companion plugin (org plan, private install) writes real Figma nodes from generated frame documents.
- Figma frames and prototype embeds render on the shared canvas (CAN-6, PRO-3).

### 4.10 Distribution (M5)

| ID | Requirement | Status |
|---|---|---|
| DIST-1 | Packaged macOS build: DMG + zip (arm64), hardened runtime, `commons://` registered in the bundle, Agent SDK unpacked from asar so it can spawn its CLI | ✅ |
| DIST-2 | Signing + notarization wired through electron-builder (Apple env vars at build time; unsigned local builds for testing) | ✅ (config; needs Developer ID cert to exercise) |
| DIST-3 | Auto-update feed | 📋 (zip target already built for it) |
| DIST-4 | Read-only web fallback viewer (DL-3) | 📋 |

## 5. Platform & technical requirements

- **Stack (locked):** Electron (macOS only) · React + TS + Vite (electron-vite) · Convex backend · pnpm monorepo. Custom infinite canvas, no canvas library.
- **Boundaries:** renderer never touches fs/network-to-local-services directly — everything through `window.commons` (typed `CommonsApi` in `packages/shared`); Convex functions are the only data path; shared types live in `packages/shared` only.
- **Design system:** all colors are `theme.css` tokens — dark chrome default plus a light token set under `data-theme="light"`; no hardcoded colors (translucent overlays use `color-mix` on tokens). Keyboard-first: every surface has a shortcut, registered in `lib/shortcuts.ts` with a description that feeds the `?` cheat sheet (`C` comment · `A` agent panel · `⌘T` team · `⌘I` inbox · `⌘L` theme · `Esc` dismiss).
- **Agent auth:** Claude Agent SDK uses the machine's Anthropic credentials (`ANTHROPIC_API_KEY` or Claude Code login); auth failures surface as session errors, not crashes.
- **Email:** Resend; unkeyed environments log and no-op.
- **Deployment topology:** Convex project `commons` (team `kyle-cooney`). Dev = `basic-raven-343` (what `pnpm dev` / `.env` targets); prod = `rapid-anteater-106` (what the packaged DMG targets, baked via `VITE_CONVEX_URL` at build time). Google OAuth env vars are set on both; the shared OAuth client lists both `.convex.site` redirect URIs. Schema/function changes reach prod only via an explicit `npx convex deploy`.

## 6. Release plan

| Milestone | Scope | Status |
|---|---|---|
| M1 — demo slice | Projects, canvas, comments, prototype view | ✅ |
| M2 — collaboration hardening | Google OAuth, invites, mention emails, deep links, presence cursors | ✅ |
| M3 — agents | Embedded sessions, thread→prompt, diff + frame refresh, adapter interface | ✅ |
| M4 — Figma bridge | Import, Figma→code workflow, companion plugin | 📋 |
| M5 — distribution | Signing, notarization, auto-update, web fallback | 🚧 (unsigned packaged build in daily use against prod; Developer ID cert in progress) |

## 7. Open questions & known gaps

1. **Previews show pushed state only:** deploy previews update on push/deploy, so agent edits are visible live only on the host's machine until pushed. Cloud execution (AG-10) + branch previews is the durable answer.
2. **Agent guardrails** (AG-7): `acceptEdits` + pre-allowed Bash is right for the demo loop but there's no per-tool approval UI, cost ceiling, or branch isolation. Decide how much control designers need before the pilot.
3. **Agent replies post as the host user** (AG-8): the thread reply is authored by whoever hosted the session, prefixed "⚡ Agent". A first-class agent identity (own avatar/author) is nicer but needs a users-table decision.
4. **Stale sessions are reconciled on next host launch** — a session orphaned by a crash stays "running" until the host reopens Commons. A time-based heartbeat would close that window fully.
5. **Interrupt fidelity:** SDK `interrupt()` is best-effort for single-string prompts; a stopped session may finish its in-flight turn silently.
6. **Dynamic routes:** sample params for `/posts/[id]`-style routes are user-edited; no validation that they resolve.
7. **GitHub integration ladder** (from the repo-sync discussion): (a) local git awareness — branch/ahead-behind on the dev chip with a one-click pull; (b) GitHub App for automatic per-branch/PR preview URLs and PR chips; (c) branch-per-agent-session with PR flow (pairs with AG-10). Commons never pulls/pushes autonomously.
8. **Legacy `repoPath`:** the deprecated shared field is still in the schema for old documents; existing projects need one "Locate repo" click per user to create their `repoLink`.
9. **Desktop/backend version skew:** with no auto-update (DIST-3), installed apps can run ahead of or behind prod. Renderer changes must tolerate the older backend (e.g. card thumbnails guard against the field being absent), and backend deploys should stay backward-compatible with the last shipped DMG.
10. **Expo web fidelity:** frames show the react-native-web rendering; native-only modules (camera, haptics) differ or no-op. First frame paint per route waits on Metro's initial web bundle (~10–30s cold). Validated as a feature in the pilot: the preview surfaced a real cross-platform bug in Felix (an RN hook `react-native-web` doesn't export, crashing every tab route on web) that was then fixed upstream — the preview is the real app, so it finds real bugs.
11. **Privacy trust model:** project visibility is enforced in every Convex query, but functions still trust the `userId` argument (the session token isn't threaded through per-call). Real privacy against a motivated insider — and the M5 web viewer — requires resolving the user from `sessionToken` server-side in project-scoped functions.
12. **Sharing model (per audience):** teammates → `commons://` deep links, with per-frame/per-thread copy-link buttons as the near-term gap; stakeholders → the M5 web viewer with tokenized "anyone with the link" access (schematic canvas thumbnail doubles as the Slack unfurl image); user-testing participants → deploy-preview URL + route today, first-class "Flows" (named, ordered frame sequences) if the pilot pulls for them.

---

*Related docs: `SPEC.md` (decisions, source of truth) · `PRFAQ.md` (working-backwards press release) · `CLAUDE.md` (agent/dev conventions) · `README.md` (setup).*
