import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@commons/backend/convex/_generated/api";
import type { Id } from "@commons/backend/convex/_generated/dataModel";
import SignIn from "./views/SignIn";
import ProjectList from "./views/ProjectList";
import ProjectView from "./views/ProjectView";
import Inbox from "./views/Inbox";
import Team from "./views/Team";
import Welcome from "./views/Welcome";
import ShortcutsHelp from "./views/ShortcutsHelp";
import UpdateChip from "./views/UpdateChip";
import WorkspacesMenu from "./views/WorkspacesMenu";
import CommandPalette from "./views/CommandPalette";
import ThemeToggle from "./views/ThemeToggle";
import AccountMenu from "./views/AccountMenu";
import { clearStoredSession, getStoredSession, initials, type StoredSession } from "./lib/session";

export type Nav =
  | { screen: "home" }
  | {
      screen: "project";
      projectId: Id<"projects">;
      view: "canvas" | "prototype";
      frameId?: Id<"frames">;
      threadId?: Id<"threads">;
    };

export default function App() {
  const [session, setSession] = useState<StoredSession | null>(getStoredSession());
  const [nav, setNav] = useState<Nav>(() => {
    // Browser links target app state via the hash (#p=<id>&view=…&thread=…);
    // the desktop app uses commons:// deep links instead.
    const params = new URLSearchParams(window.location.hash.slice(1));
    const projectId = params.get("p");
    if (projectId) {
      return {
        screen: "project",
        projectId: projectId as Id<"projects">,
        view: params.get("view") === "prototype" ? "prototype" : "canvas",
        threadId: (params.get("thread") as Id<"threads">) ?? undefined,
        frameId: (params.get("frame") as Id<"frames">) ?? undefined,
      };
    }
    return { screen: "home" };
  });
  const me = useQuery(api.auth.validate, session ? { sessionToken: session.token } : "skip");
  const touch = useMutation(api.auth.touch);
  const signOut = useMutation(api.auth.signOut);

  useEffect(() => {
    // Absent when the renderer runs in a plain browser (web-fallback viewer).
    if (!window.commons) return;
    return window.commons.onDeepLink((link) => {
      setNav({
        screen: "project",
        projectId: link.projectId as Id<"projects">,
        view: link.view,
        frameId: link.frameId as Id<"frames"> | undefined,
        threadId: link.threadId as Id<"threads"> | undefined,
      });
    });
  }, []);

  useEffect(() => {
    if (session) void touch({ sessionToken: session.token }).catch(() => {});
  }, [session, touch]);

  // Finalize mirrored agent sessions orphaned by a previous quit/crash of this
  // host — anything not alive in the main process can't still be running.
  const reconcileAgentSessions = useMutation(api.agentSessions.reconcileHost);
  const meId = me?._id;
  useEffect(() => {
    if (!meId || !window.commons) return;
    window.commons.listAgentSessions().then((list) => {
      const activeMirrorIds = list
        .map((info) => info.context.mirrorSessionId)
        .filter((id): id is string => !!id) as Id<"agentSessions">[];
      void reconcileAgentSessions({ hostUserId: meId, activeMirrorIds }).catch(() => {});
    });
  }, [meId, reconcileAgentSessions]);

  // Stored token no longer valid (signed out elsewhere, db reset) — sign in again.
  useEffect(() => {
    if (session && me === null) {
      clearStoredSession();
      setSession(null);
    }
  }, [session, me]);

  if (!session || !me) {
    return <SignIn onSignedIn={setSession} />;
  }

  const doSignOut = () => {
    void signOut({ sessionToken: session.token }).catch(() => {});
    clearStoredSession();
    setSession(null);
  };

  if (nav.screen === "project") {
    return (
      <>
        <ShortcutsHelp />
        <ProjectView key={nav.projectId} me={me} nav={nav} setNav={setNav} />
        <CommandPalette me={me} setNav={setNav} />
        <UpdateChip />
      </>
    );
  }

  return (
    <div className="app">
      <div className="titlebar">
        <span className="wordmark">Commons</span>
        <span className="spacer" />
        <ThemeToggle />
        <WorkspacesMenu me={me} />
        <Team me={me} />
        <Inbox me={me} setNav={setNav} />
        <AccountMenu me={me} onSignOut={doSignOut} />
      </div>
      <ProjectList me={me} setNav={setNav} />
      <ShortcutsHelp />
      <Welcome name={me.name} />
      <CommandPalette me={me} setNav={setNav} />
      <UpdateChip />
    </div>
  );
}
