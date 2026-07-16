# Commons

Design in Figma or in code — collaborate on both through one shared canvas. See [SPEC.md](SPEC.md) for the full product spec and milestones.

## Run it

```sh
pnpm install
pnpm -C packages/backend dev     # Convex backend (local anonymous deployment works out of the box)
pnpm -C apps/desktop dev         # Electron app
```

The app connects to the Convex URL in `apps/desktop/.env` (`VITE_CONVEX_URL`). For the team-shared backend, create a real Convex deployment (`npx convex dev` and log in, or `npx convex deploy`) and point everyone's `.env` at it — comments, presence, and the project list sync live across machines.

## Google sign-in setup

Sign-in is Google OAuth through the system browser, finishing on a `commons://` deep link. One-time setup on the Convex deployment:

1. In [Google Cloud console](https://console.cloud.google.com/apis/credentials), create an OAuth client of type **Web application**. Add the authorized redirect URI `https://<your-deployment>.convex.site/auth/google/callback` (the `.convex.site` HTTP-actions domain, not `.convex.cloud`; find it with `npx convex env get CONVEX_SITE_URL` or in the dashboard).
2. `npx convex env set GOOGLE_CLIENT_ID <id>` and `npx convex env set GOOGLE_CLIENT_SECRET <secret>` (run in `packages/backend`).
3. For @mention and invite emails: `npx convex env set RESEND_API_KEY <key>` ([resend.com](https://resend.com)) and optionally `EMAIL_FROM` (e.g. `Commons <commons@yourdomain.com>`, a domain verified in Resend). Without a key, emails are skipped and logged — everything else works.

Membership is invite-only: the **first** Google sign-in on a fresh deployment creates the first account; after that, an email must be invited (Team menu, ⌘T) before it can sign in.

In dev, the `commons://` callback may not reach the unpackaged app — sign-in still completes, because the app also watches the auth handshake live through Convex. Packaged builds (`pnpm -C apps/desktop dist`) register the `commons://` protocol with macOS via the app bundle, which also makes deep links in mention emails open the app directly.

## Using it

1. Sign in with Google (system browser opens; first user bootstraps the team, everyone else needs an invite).
2. **+ Add project** → pick a local Next.js repo. Routes are auto-discovered, the dev server is spawned on a free port, and each screen lands as a live frame on the canvas.
3. Pan with two-finger scroll or drag; zoom with pinch / ⌘-scroll. Click a frame to interact with the live app inside it; Esc to release.
4. **C** toggles comment mode — click anywhere (frame or canvas) to start a thread; `@` mentions teammates, who see it in their Inbox.
5. **Prototype** tab shows the running app full-size with device-width presets. **Copy link** puts a `commons://` deep link on the clipboard.
6. Open a thread and hit **⚡ Agent** to send the feedback to Claude Code against your local repo — the session streams into the agent panel (**A**), teammates watch it live, the summary lands back in the thread, and the frame reloads when edits finish. Needs Anthropic credentials on the host machine (`ANTHROPIC_API_KEY` or a Claude Code login).
7. Teammates without the repo see frames via the project's deployed **Preview** URL (titlebar) once someone sets it; "Locate repo on this Mac" gives you live local frames and agent hosting.

## Distributable build

```sh
VITE_CONVEX_URL=https://<team-deployment>.convex.cloud pnpm -C apps/desktop dist
```

Produces a DMG + zip in `apps/desktop/release/` with the `commons://` protocol registered in the bundle. Packaging config lives in `apps/desktop/electron-builder.yml` (single source of truth — don't add a `build` block to package.json).

- **Signing + notarization:** export `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID` (app-specific password from appleid.apple.com; requires a Developer ID Application certificate in your keychain). Without them the build is unsigned/un-notarized — fine for your own machine, but teammates' Macs will refuse to open it.
- **Local packaging test without certs:** `CSC_IDENTITY_AUTO_DISCOVERY=false pnpm -C apps/desktop dist`.
- The Claude Agent SDK is kept outside the asar archive (`asarUnpack`) because it spawns its CLI as a subprocess.

## Workspace

| Path | What |
|---|---|
| `apps/desktop` | Electron app — main (dev-server runner, route discovery, deep links), preload (IPC bridge), renderer (canvas, comments, prototype) |
| `packages/backend` | Convex schema + functions (users, projects, frames, threads, notifications, presence) |
| `packages/shared` | Types shared across processes and packages |
