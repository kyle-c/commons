# Using Commons with your coding agent

Commons pairs with whatever you build in: Claude Code, Codex, Hermes, Cursor, or any harness that edits a repo and runs a dev server. The split is simple: **build in your agent, collaborate in Commons.** Your agent owns authoring; Commons owns everything after: the team seeing it live, feedback pinned to pixels, drafts everyone can open, and tests with real users.

## 1. Point Commons at the repo

1. Open Commons, pick your workspace section, click **+ New project**, and choose the repo folder your agent works in.
2. Next.js, Expo, and Vite projects are auto-discovered: every route lands as a live frame on the shared canvas, clustered into sections derived from your router.
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
- The project switcher (left titlebar) carries Stop, Start, and Restart. Restart after your agent changes dev dependencies or the dev command.

## 3. The working loop

1. Prompt your agent in its own harness, as usual. Edit, iterate, run.
2. Keep the Commons canvas open beside it (or on another display). Frames render the live localhost app, so every save shows up on the canvas as it happens.
3. When a screen is worth discussing, press `C` and pin a comment to the exact pixel. Mention teammates with `@`; threads land in inboxes, email, and your workspace Slack channel.
4. Push when ready. Teammates without the repo see frames through the project's preview URL (Setup popover, "Preview link"), and snapshots cover the gaps.

## 4. Close the loop from a thread

Two ways to turn feedback into code:

- **Send to agent (built in).** Any thread has a "⚡ Agent" action. Commons builds a self-contained prompt from the conversation plus frame context and runs an embedded Claude Code session on a Commons-managed checkout, on a fresh `commons/<slug>` branch. The whole team watches the transcript live, the result posts back to the thread with before/after screenshots, and "Ship" opens the pull request. Nobody's working tree is touched, and a $5 per-session ceiling caps the bill.
- **Take it to your own harness.** Copy the thread's deep link or its text into Claude Code, Codex, or Hermes and work it there. When your agent pushes a branch matching the project's branch-preview pattern (Setup popover, "Draft previews", Vercel-style `{branch}` URL), everyone can open the draft live before it merges.

Rule of thumb: if the change is fully described by the comment, send it to the agent in Commons. If it needs exploration, take it to your harness.

## 5. Prove it with users

Any prototype with a preview link can become a task-based usability test (the Tests panel in Prototype view). Testers get one link, no account. Success rates, times, paths, and click heatmaps come back onto the canvas, and a test can A/B today's product against an agent draft's branch preview before anything merges. Failing tasks carry their own "Send to agent" with the evidence packaged into the prompt.

## 6. Per-harness notes

| Harness | How it fits |
|---|---|
| **Claude Code** | Deepest integration: it's also the engine behind thread-to-draft sessions in Commons. Externally, run it in the repo as usual; Commons picks up its dev servers and its pushes like any other. |
| **Codex** | Run in the repo; use branch pushes + the draft-preview pattern for visibility. The agent adapter interface (`apps/desktop/src/main/agents/adapter.ts`) is one file away from embedding it for thread-to-draft, when wanted. |
| **Hermes or other agents** | Same external pattern: agent edits the repo, Commons renders and detects. If the agent hosts its own server, the switcher shows it; if it pushes branches, name them to match the preview pattern and drafts go team-visible. |

## 7. Habits that make it sing

- Set the **preview link** early: it's what unlocks teammates without the repo, and user tests.
- Set the **branch preview pattern** once and every agent draft becomes a clickable link for the whole team.
- Use **project status** on the home card (Exploring, In review, Testing) so people know what feedback you want while the agent iterates.
- **Narrate** after a milestone: the annotation pass mines your threads, tests, and commits into stakeholder-ready rationale, with citations.
