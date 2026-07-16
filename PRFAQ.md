# Commons — PR/FAQ

*Amazon-style "working backwards" document. The press release is written from the future — the day the team pilot launches. The FAQ is honest about today. Companion docs: [PRD.md](PRD.md) (requirements & status), [SPEC.md](SPEC.md) (decisions).*

---

## Press Release

**FOR RELEASE — SEPTEMBER 2026**

### Commons turns the codebase into the design file — and the whole team into collaborators

*Design teams can now comment on, prototype with, and ship changes to the real product — no engineering hand-off, no drifting mockups.*

Today the design team launched **Commons**, a shared canvas where the running product — not a picture of it — is the thing everyone collaborates on. Every screen of every project renders live on an infinite canvas. Anyone on the team can pan around it, click into a real prototype, pin a comment to the exact pixel they mean, and — this is the part that changes the job — send that comment thread to a coding agent that edits the actual codebase and re-renders the screen while the team watches.

**The problem.** Over the past two years, design work moved into code. AI made "the codebase is the design file" real: designer-engineers now iterate on the product directly, and the mockup era's core artifact — the static design file — stopped being the source of truth. But collaboration never made the jump. Figma still has the canvas, the comments, the share link; the code has none of that. Feedback regressed to screenshots in Slack, and only people who could run the repo could see current state, let alone act on it. The team's researcher, content designer, and PMs — half the people whose judgment shapes the product — were locked out of the medium where the product now lives.

**The solution.** Commons rebuilds the collaborative layer on top of the real product. Point it at a repo and every screen lands on a shared canvas as a live frame — a Next.js web app renders desktop screens, an Expo app renders phone screens, no configuration. The canvas even organizes itself from the code's own structure: screens cluster into labeled sections derived from the app's routes — the structure a designer would spend an afternoon drawing by hand in Figma, generated and always current. Teammates without the repo see the same canvas through deploy previews, and everyone is visibly *in* it: live cursors with names, presence avatars, a minimap showing where the conversations are. Comments pin to screens and survive re-renders; @mentions land in inboxes and email; every project, screen, and thread has a link that opens Commons to that exact spot. And when feedback needs a code change, "Send to agent" turns the thread into a working session: Claude Code edits the repo, the whole team watches the session live, the summary posts back into the thread, and the frame re-renders with the change. Feedback-to-fix went from a sprint-planning conversation to a coffee break.

"The unlock isn't any single feature — it's that there's finally one place where seeing the product, discussing it, and changing it are the same activity," said **Kyle Cooney**, who leads the design team. "A researcher pins a comment on a live screen, an agent proposes the fix, and the designer just… approves it. The distance between noticing and shipping collapsed."

**Getting started** takes two minutes: install the Commons app, sign in with your team Google account (membership is invite-only), and open a project from the shared list. If you have the repo locally, one click gives you live frames and lets you host agent sessions; if you don't, you see everything through previews and can comment, mention, and watch agents work all the same.

"I haven't opened a screenshot annotation tool in a month," said **Maya R., product designer on the team**. "I comment on the real app, and half the time the fix is rendered before standup. The canvas map on each project card even shows where the conversations are happening."

Commons is live for the team today. Figma frames land on the same canvas next — one canvas for both sources, whichever direction the work flows.

---

## FAQ

**Q: Does Commons replace Figma?**
No — it replaces what Figma was being *misused* for: reviewing and discussing a product that actually lives in code. Figma remains the place for early exploration and the design system. Next on the roadmap, Figma frames land on the same Commons canvas (view + comment), plus the bidirectional bridge: Figma frames scaffolding code via agents, and generated screens written back as real Figma nodes.

**Q: What stacks can it render today?**
Next.js (app + pages router) and Expo/React Native with expo-router + react-native-web, auto-discovered. Anything else currently shows placeholders; a manual dev-command + URL-list escape hatch is spec'd but not built. Expo caveat: frames show the *web* rendering — native-only modules (camera, haptics) no-op.

**Q: Do teammates need the repo / a dev environment?**
No. Truth lives in git; Commons never syncs source code. People with a working copy get live local frames and can host agent sessions. Everyone else sees frames via the project's deploy-preview URL and gets the full commenting, prototyping, and agent-watching experience. Caveat: previews show *pushed* state, so an agent's uncommitted edits render live only on the host's machine.

**Q: Who can get in?**
Invite-only, gated at sign-in: the first Google account bootstraps the team; after that an email must hold an invite (⌘T). This is enforced server-side regardless of the OAuth client's settings.

**Q: Is it safe to let agents edit the codebase?**
Pilot posture: sessions run on the host designer-engineer's machine against their working copy, under their own Anthropic credentials — the blast radius is a git checkout, and every tool call streams to the whole team in the session panel. Known gaps we've chosen to accept for the pilot (tracked in the PRD): no per-tool approval UI, no cost ceiling, no branch isolation. Cloud execution with branch + preview isolation is the designed next step (tracked in the PRD as AG-10).

**Q: Why a desktop app instead of a web app?**
Commons spawns dev servers, reads local repos, and hosts agent processes — that's a desktop job. A read-only web fallback for PMs (same `commons://` URLs, browser rendering) is on the roadmap.

**Q: What's deliberately not being built?**
Multi-tenant SaaS, billing, orgs, roles beyond member, non-macOS platforms, and code sync between machines. Commons maintains exactly two mappings — who has a working copy, and where previews live — and lets git be git.

**Q: What stands between today and the press release above?**
Three things. (1) A signed, notarized DMG — packaging is done and in daily use; the Developer ID certificate is in progress. (2) A first-class agent identity for thread replies (summaries currently post as the session's host). (3) Enough pilot mileage to trust the agent loop's guardrails before inviting the full team. Figma import starts after those.
