# Commons

A macOS desktop app where a design team designs in Figma **or** in code — interchangeably — and collaborates on both through one shared canvas. Commons operationalizes the [AI Design Playbook](https://kylecooney.com/ai-design-playbook): the codebase is the design file; Figma's residual value (the canvas, conversational collaboration, design-system alignment) is rebuilt on top of *both* sources.

Decided in the founding interview, 2026-07-09. This document is the source of truth — update it when decisions change.

## Who it's for

Kyle's team: 5 designers, 1 researcher, 1 content designer, and several PMs (~8–12 pilot users). Real multi-user from v1: accounts, invites, mentions. No billing, orgs, or scale work.

## Core concepts

- **Project** — either (or both) a local code repo and a Figma file. Every project appears in the shared **project list** (home view) for the whole team.
- **Canvas view** — an infinite canvas of **frames**. A frame is a live code preview (a route of the project's dev server rendered in an embedded browser frame) or a Figma frame (rendered via the Figma REST API). Projects that have both can toggle per-frame or per-canvas.
- **Prototype view** — the running thing, full-size: the code project in an embedded webview (clickable, real), or the Figma prototype embed.
- **Comments** — threaded comments pinned to a frame at a relative x/y (they survive re-layout and re-render) or to the canvas itself. @mentions of invited teammates → in-app inbox + email notification.
- **Direct links** — `commons://` deep links to any project / view / frame / thread. Web fallback: the same URL serves a read-only browser view of the canvas or prototype for people without the app (PMs).
- **Agent sessions** — embedded Claude Code sessions (Claude Agent SDK). Select a comment thread or frame → "send to agent" → watch the diff land and the frame re-render. Adapter interface so Codex/Hermes can be added later.
- **Figma bridge (bidirectional, required for v1 overall)** —
  - *Figma → code:* point at a Figma frame; the agent scaffolds/updates the code project from it (Figma REST API/MCP + agent session).
  - *Code → Figma:* a companion Figma plugin (team is on an org plan; private plugin install is available) reads generated frame documents from the backend and writes real Figma nodes.

## Stack (locked)

| Layer | Choice |
|---|---|
| Shell | Electron, macOS only, signed + notarized, auto-update |
| UI | React + TypeScript + Vite (electron-vite), custom infinite canvas |
| Backend | Convex — auth, projects, threads/comments, mentions, presence, realtime sync |
| Auth | Google sign-in (system-browser OAuth → `commons://` callback), wired in M2. Invite-gated: first sign-in on a fresh deployment bootstraps the team, everyone after needs an invite. Code exchange happens in a Convex HTTP action (Google can't redirect straight to a custom scheme), which then bounces to `commons://auth/callback`. |
| Code targets | Next.js / React (app router) auto-discovery; anything else via manual dev-command + URL list |
| Agent | Claude Code via Claude Agent SDK (reference adapter) |
| Figma | REST API for reads/renders; companion plugin for writes |
| Aesthetic | Pro-tool dark chrome — Figma/Linear-adjacent, dense, keyboard-first, canvas is the hero |
| Repo | pnpm monorepo |

## Repo layout

```
apps/desktop        Electron app (main / preload / renderer)
packages/backend    Convex schema + functions
packages/shared     Types shared between renderer, main, backend, plugin
packages/figma-plugin  Companion plugin (code → Figma writes)   [later milestone]
apps/web            Read-only web fallback viewer               [later milestone]
```

## Milestones

**M1 — the demo slice (build first):**
1. Project list view: all active team projects, who's on them, live status.
2. Add project → point at local Next.js repo → routes auto-discovered → dev server spawned → live frames on the canvas.
3. Pan/zoom canvas; threaded comments with pins, synced live through Convex.
4. Prototype view with device-width presets.

**M2 — collaboration hardening:** Google OAuth, invites, @mention inbox + email, presence cursors, `commons://` deep links end-to-end.

**M3 — agents:** embedded Claude Code sessions; comment-thread → prompt; diff + frame refresh loop; adapter interface.

**M4 — Figma bridge:** Figma import (frames on canvas, prototype embed), Figma→code agent workflow, companion plugin for code→Figma.

**M5 — distribution:** signing, notarization, auto-update feed, web fallback viewer.

## Design notes

- Frames render live localhost iframes inside the zoomable canvas; interaction is captured for pan/zoom until a frame is focused (click-through model like Figma's prototype hover).
- Comment anchors: `{frameId, fx, fy}` with fx/fy ∈ [0,1] relative to frame bounds; canvas pins use absolute canvas coords.
- Route discovery: scan `app/**/page.{tsx,jsx,ts,js}` (app router) and `pages/**` (pages router), skip route groups' parentheses segments when building URLs, represent dynamic segments with sample params the user can edit.
- One dev server per open project, spawned by the Electron main process on a free port; renderer never touches the filesystem directly (IPC only).
