# Commons

One shared canvas showing the app that actually runs. A team comments on live screens, hands a thread to a coding agent, and keeps the reasoning attached to the work. Marketing site and downloads: [trycommons.app](https://trycommons.app).

Product strategy and roadmap live in a private companion repo ([kyle-c/commons-docs](https://github.com/kyle-c/commons-docs)); `SPEC.md` there is the source of truth for locked decisions.

## Run it

```sh
pnpm install
pnpm dev
```

`pnpm dev` starts the Convex dev server and the Electron app together. To run them separately:

```sh
pnpm -C packages/backend dev
pnpm -C apps/desktop dev
```

The app reads `VITE_CONVEX_URL` from `apps/desktop/.env`. Point everyone at one real Convex deployment and projects, comments, presence, and agent sessions sync live across machines.

Other commands:

```sh
pnpm typecheck
pnpm test
pnpm build
```

`pnpm typecheck` also runs `scripts/check-convex-auth.mjs`, which fails on any public Convex function that does not resolve identity from a `sessionToken`.

## What it does

**Canvas.** Point a project at a local repo and Commons discovers its routes, spawns a dev server on a free port, and puts every screen on an infinite canvas as a live frame. Next.js, Expo, and Vite are auto-discovered; anything else that serves HTTP works via a `commons.json`. A monorepo with more than one app asks which one the project is instead of guessing. Teammates without the repo see the same screens through the project's deployed preview URL.

**Comments.** Threads pinned to a frame at relative coordinates, so they survive re-layout and re-render. @mentions reach an in-app inbox and email. Live cursors and presence while reviewing together.

**Agents.** Send a thread to a coding agent and it picks up the screen, the route, and the conversation. Runs locally through the Claude Agent SDK, or in the repo's own GitHub Actions when no laptop is awake. Work lands on a branch, never on a dirty tree, and never merges itself. Uses your own Anthropic or OpenRouter key, set in the app.

**Prototype.** The running app full-size with device presets.

**Flow.** The app as a directed graph: screens laid out by navigation depth, edges derived from recorded tester sessions, unreached screens parked apart. State frames capture a screen in an error, empty, or loading condition, either recorded by a person or proposed by a Playwright crawl that runs in the repo's own Actions. Nothing a crawl proposes joins the graph until a human approves it.

**Narrate.** Drafts the reasoning behind each screen from threads, tests, and code history, with citations, and labels its inferences as inferences. Nothing publishes without approval.

**User tests.** Tasks sent as one link; testers use the live app with no account. Success rates, times, paths, and click heatmaps come back onto the canvas. Real visitors can be recruited with a script tag.

**Sharing.** Share links open the same canvas for people with no account, who can read and comment with just a name.

**GitHub App.** Connect once and deploy events fill in preview URLs, infer the per-branch draft preview pattern, and refresh snapshots when production deploys.

## Backend setup

Sign-in is Google OAuth through the system browser (finishing on a `commons://` deep link) or a magic email link. Signup is open: a new account lands in its own personal workspace, and a corporate email domain auto-joins that domain's workspace when one exists.

One-time setup on a Convex deployment:

1. In the [Google Cloud console](https://console.cloud.google.com/apis/credentials), create an OAuth client of type **Web application** with the redirect URI `https://<your-deployment>.convex.site/auth/google/callback`. That is the `.convex.site` HTTP-actions domain, not `.convex.cloud` — find it with `npx convex env get CONVEX_SITE_URL`.
2. From `packages/backend`: `npx convex env set GOOGLE_CLIENT_ID <id>` and `npx convex env set GOOGLE_CLIENT_SECRET <secret>`.
3. For mention, invite, and magic-link emails: `npx convex env set RESEND_API_KEY <key>` ([resend.com](https://resend.com)) and optionally `EMAIL_FROM`. Without a key, emails are skipped and logged; everything else works.

The GitHub App (deploy events, cloud agents, flow crawls) additionally needs `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_PRIVATE_KEY`, and `GITHUB_WEBHOOK_SECRET`. The slug is what builds the install URL, so "Connect GitHub" reports the app as unconfigured without it. Set the private key from a file rather than pasting it: `npx convex env set GITHUB_APP_PRIVATE_KEY --from-file key.pem`.

In dev, the `commons://` callback may not reach an unpackaged app — sign-in still completes, because the app also watches the handshake through Convex. Packaged builds register the protocol with macOS, which is also what makes deep links in emails open the app.

## Shipping a release

```sh
pnpm ship --notes "What changed, in a sentence or two."
```

Builds, signs, notarizes, publishes the GitHub release, updates the auto-update feed, and verifies the published artifact end to end. Release notes are required because they are what people read in the update prompt. Signing needs `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID` in the environment, plus a Developer ID Application certificate in the keychain.

The tree is read for the length of the build, so avoid editing files while `ship` runs.

For a packaging test without certificates:

```sh
CSC_IDENTITY_AUTO_DISCOVERY=false pnpm -C apps/desktop dist
```

Packaging config lives in `apps/desktop/electron-builder.yml` and is the single source of truth; do not add a `build` block to `package.json`. The Claude Agent SDK stays outside the asar archive (`asarUnpack`) because it spawns its CLI as a subprocess.

## Workspace

| Path | What |
|---|---|
| `apps/desktop/src/main` | Dev-server runner, route discovery, git operations, snapshots, external-server detection, deep links, updater |
| `apps/desktop/src/preload` | The IPC bridge (`window.commons`); the renderer never touches fs or local services directly |
| `apps/desktop/src/renderer` | Canvas, comments, prototype, flow, agent panel, user tests |
| `packages/backend/convex` | Schema and all functions: auth, projects, threads, agents, flows, user tests, GitHub App, the marketing page |
| `packages/shared` | Types shared across renderer, main, and backend |

## Conventions

Strict TypeScript everywhere; shared types live in `packages/shared` and are never duplicated across processes. Every public Convex function resolves identity from a `sessionToken` (`requireViewer` / `requireProjectAccess` in `access.ts`) — a `userId` argument is a claim, never proof, because Convex publishes public functions to the open internet. Design tokens live in `apps/desktop/src/renderer/src/theme.css`; no hardcoded colors. Every new surface gets a keyboard shortcut registered in `lib/shortcuts.ts`.

`DESIGN.md` is the design system, and deviations from it are treated as bugs even when the code works.
