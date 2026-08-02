# Using Commons with your coding agent

Commons pairs with whatever you build in: Claude Code, Codex, Hermes, Cursor, or any harness that edits a repo and runs a dev server. The split is simple: **build in your agent, collaborate in Commons.** Your agent owns authoring; Commons owns everything after: the team seeing it live, feedback pinned to pixels, drafts everyone can open, and tests with real users.

Commons lives at [trycommons.app](https://www.trycommons.app). The Mac app is what you want on the machine your agent runs on, since it hosts dev servers and agent sessions. Everyone else on the team can stay in the browser.

## 1. Point Commons at the repo

1. Open Commons, pick your workspace section, click **+ New project**, and choose the repo folder your agent works in.
2. Next.js, Expo, and Vite projects are auto-discovered: every route lands as a live frame on the shared canvas, clustered into sections derived from your router.
   - **Monorepos work**: pick the repo root and Commons descends into the app folder (`frontend/`, `web/`, whatever holds the app) and runs the dev server there. If the repo holds more than one app, it asks which one this project is rather than choosing for you — a web app and a mobile app are two projects, so add the repo twice and pick a different app each time.
   - **Fresh clone?** If `node_modules` is missing when a server first starts, Commons installs dependencies with your detected package manager before starting, so a teammate who just cloned does not hit a half-running server.
3. Anything else that serves HTTP: drop a `commons.json` in the repo root and it becomes a first-class project:

```json
{
  "devCommand": ["npm", "run", "dev", "--", "--port", "{port}"],
  "routes": [
    { "title": "Home", "path": "/" },
    { "title": "Settings", "path": "/settings", "section": "Account" }
  ]
}
```

## 2. Let the servers sort themselves out

- Commons starts and owns a dev server per open project, on its own port, and cleans it up when you leave.
- Already running the app from your agent or a terminal? Commons detects servers started **outside** it whose working directory is inside the project, and shows them in the project switcher ("also on :3000, outside Commons"). It never kills another tool's process; stop it there if you want Commons's server to be the one.
- The server menu (the status dot and chevron in the project subnav) carries Stop, Start, and Restart. Restart after your agent changes dev dependencies or the dev command.

## 3. The working loop

1. Prompt your agent in its own harness, as usual. Edit, iterate, run.
2. Keep the Commons canvas open beside it (or on another display). Frames render the live localhost app, so every save shows up on the canvas as it happens.
3. When a screen is worth discussing, press `C` and pin a comment to the exact pixel. Mention teammates with `@`; threads land in inboxes, email, and your workspace Slack channel.
4. Push when ready. Teammates without the repo see frames through the project's preview URL (the **link icon** in the project subnav), and snapshots cover the gaps.

## 4. Close the loop from a thread

Two ways to turn feedback into code:

- **Send to agent (built in).** Any thread has a "⚡ Agent" action. Commons builds a self-contained prompt from the conversation plus frame context and runs a Claude Code session on a Commons-managed checkout, on a fresh `commons/<slug>` branch. The whole team watches the transcript live, the result posts back to the thread with before/after screenshots, and "Ship" opens the pull request. Nobody's working tree is touched, and a $5 per-session ceiling caps the bill.
  - **On your Mac,** which is the default and needs the repo on that machine.
  - **In your repo's own GitHub Actions,** once the workspace has connected the GitHub App. Nobody's laptop has to be awake, and the run happens under your organization's own credentials in your own CI. The workflow only fires from your default branch, so it has to be merged there before the first run.
- **Take it to your own harness.** Copy the thread's deep link or its text into Claude Code, Codex, or Hermes and work it there. When your agent pushes a branch matching the project's branch-preview pattern (the **branch icon** in the project subnav, a Vercel-style `{branch}` URL), everyone can open the draft live before it merges.

Rule of thumb: if the change is fully described by the comment, send it to the agent in Commons. If it needs exploration, take it to your harness.

**Model credentials.** Agent runs bill to your own account, never through Commons. Set an Anthropic or OpenRouter key from the agent panel's setup step; it does not require a terminal, and local runs also accept an existing Claude Code login. Cloud runs read the key from the repo's own Actions secrets.

> Running a build older than v0.2.65? Update first. Before that release the embedded agent and Narrate could not launch from the packaged app at all (the Agent SDK's bundled binary could not be spawned from inside the app archive), so both failed with `spawn ENOTDIR`.

## 5. Prove it with users

Any prototype with a preview link can become a task-based usability test (the Tests panel in Prototype view). Testers get one link, no account. Success rates, times, paths, and click heatmaps come back onto the canvas, and a test can A/B today's product against an agent draft's branch preview before anything merges. Failing tasks carry their own "Send to agent" with the evidence packaged into the prompt.

## 6. Watch the shape of the app change

Agents add routes faster than anyone updates a diagram, so the **Flow** view (⌘3) builds one from evidence instead. Screens are laid out by how deep they sit in the journey, edges come from paths real tester sessions took, and screens nobody ever reached are parked where you cannot miss them. Nothing to maintain: it is a record, not a drawing.

**State frames** put a screen's error, empty, and loading conditions beside its happy path. Capture one yourself, or let a browser crawl go and provoke them against your deployed preview. The crawl runs as Playwright in your own GitHub Actions, the same vehicle as cloud agents, and everything it finds lands in a review queue. Nothing a crawl proposes joins the graph until a person approves it.

Useful right after an agent lands a feature: the new screens appear, and anything it wired up but never linked to shows as unreached.

## 7. When the app is behind a login

Every frame and the prototype share one browser session, so signing in once covers the whole canvas. If your screens all render the login page, open the preview link popover and use **Sign in to previews**, which drops you into the full-size app to sign in, then reloads the screens.

## 8. Per-harness notes

| Harness | How it fits |
|---|---|
| **Claude Code** | Deepest integration: it's also the engine behind thread-to-draft sessions in Commons. Externally, run it in the repo as usual; Commons picks up its dev servers and its pushes like any other. |
| **Codex** | Run in the repo; use branch pushes + the draft-preview pattern for visibility. The agent adapter interface (`apps/desktop/src/main/agents/adapter.ts`) is one file away from embedding it for thread-to-draft, when wanted. |
| **Hermes or other agents** | Same external pattern: agent edits the repo, Commons renders and detects. If the agent hosts its own server, the switcher shows it; if it pushes branches, name them to match the preview pattern and drafts go team-visible. |

## 9. Habits that make it sing

- **Connect GitHub once** and stop pasting URLs. Deploy events fill in the preview link, infer the `{branch}` draft pattern from two or more branch deploys, and refresh every snapshot when production deploys. A pattern is only accepted when it reproduces every URL actually observed, so one disagreement rejects it rather than guessing. Anything you type by hand is never overwritten.
- Set the **preview link** early if you are not connecting GitHub: it's what unlocks teammates without the repo, and user tests.
- Use **project status** on the home card (Exploring, In review, Testing) so people know what feedback you want while the agent iterates.
- **Narrate** after a milestone: the annotation pass mines your threads, tests, and commits into stakeholder-ready rationale, with citations. It runs on a machine that has the repo, and drafts land in a review queue for a person to approve.
- **Share the link, not the install.** A project's Share menu mints a page that opens the canvas for anyone, with pan, zoom, a switch into the running prototype, and commenting by name alone. That is usually the right thing to send a stakeholder, rather than asking them to sign in.
- **Tidy** (canvas toolbar) snaps every screen into an organized grid while you are reading, then returns to your arrangement. Handy when an agent has just added routes and the canvas has grown.
- **Collapse workspaces** you are not working in on the home grid; the fold is remembered per machine.
