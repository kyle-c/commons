# Commons — agent instructions

Read `SPEC.md` first; it is the source of truth for product and architecture decisions. Do not re-open locked decisions (stack, backend, aesthetic) without Kyle asking.

## Commands

- `pnpm install` — install everything (pnpm workspaces)
- `pnpm dev` — start Convex dev (local) + the Electron app
- `pnpm -C apps/desktop dev` — Electron app only
- `pnpm -C packages/backend dev` — Convex dev server only
- `pnpm typecheck` — typecheck all packages
- `pnpm build` — production build of the desktop app

## Conventions

- TypeScript everywhere, strict. Shared types live in `packages/shared` — never duplicate a type across renderer/main/backend.
- Renderer never touches fs/network-to-localhost-services directly; everything through the preload IPC bridge (`window.commons`).
- Convex functions are the only way data moves; no direct table access patterns in the client beyond generated hooks.
- Dark-chrome design tokens live in `apps/desktop/src/renderer/src/theme.css`. Use the CSS variables; no hardcoded colors.
- Keyboard-first: every new surface gets a shortcut; register it in `lib/shortcuts.ts`.
