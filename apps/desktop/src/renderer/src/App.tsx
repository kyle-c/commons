import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@commons/backend/convex/_generated/api";
import type { Id } from "@commons/backend/convex/_generated/dataModel";
import SignIn from "./views/SignIn";
import GuestView from "./views/GuestView";
import ProjectList from "./views/ProjectList";
import ProjectView from "./views/ProjectView";
import Welcome from "./views/Welcome";
import ShortcutsHelp from "./views/ShortcutsHelp";
import UpdateChip from "./views/UpdateChip";
import CommandPalette from "./views/CommandPalette";
import { clearStoredSession, getStoredSession, initials, type StoredSession } from "./lib/session";
import { getRecents } from "./lib/recents";
import { applyStoredPreviewAppearance } from "./lib/previewAppearance";
import { loadTabs, saveTabs, type ProjectTab } from "./lib/tabs";
import TabBar from "./components/TabBar";

export type Nav =
  | { screen: "home" }
  | {
      screen: "project";
      projectId: Id<"projects">;
      view: "canvas" | "prototype";
      frameId?: Id<"frames">;
      threadId?: Id<"threads">;
    };

/**
 * A share link is served by the same bundle as the app, so the very first
 * decision is which of the two this is. Guest mode short-circuits everything
 * below it: no stored session is read, no tabs are restored, and no sign-in is
 * ever shown, because the token in the path is the entire credential.
 */
function guestToken(): string | null {
  const path = window.location.pathname;
  if (!path.startsWith("/g/")) return null;
  const token = path.slice("/g/".length).replace(/\/+$/, "");
  return token || null;
}

export default function App() {
  const shareToken = guestToken();
  if (shareToken) return <GuestView shareToken={shareToken} />;

  const [session, setSession] = useState<StoredSession | null>(getStoredSession());
  const [nav, setNavState] = useState<Nav>(() => {
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
    // No deep link: land on the last active tab from the previous session.
    const stored = loadTabs();
    if (stored.active !== "home") {
      return { screen: "project", projectId: stored.active as Id<"projects">, view: "canvas" };
    }
    return { screen: "home" };
  });

  // Open-project tabs (Figma-style). Tabs are navigation state only: the
  // active tab mounts, background tabs are just entries. Each tab remembers
  // its own view/frame/thread so switching back lands where you left.
  const [tabs, setTabs] = useState<ProjectTab[]>(() => loadTabs().tabs);
  const navRef = useRef(nav);
  navRef.current = nav;
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const navByTabRef = useRef<Record<string, Nav>>({});
  const activeId = nav.screen === "project" ? (nav.projectId as string) : "home";

  const setNav = (next: Nav | ((prev: Nav) => Nav)) => {
    const prev = navRef.current;
    const resolved = typeof next === "function" ? next(prev) : next;
    if (prev.screen === "project") navByTabRef.current[prev.projectId] = prev;
    if (resolved.screen === "project") {
      const id = resolved.projectId as string;
      setTabs((t) =>
        t.some((tab) => tab.id === id)
          ? t
          : [...t, { id, name: getRecents().find((r) => r.id === id)?.name ?? "Project" }]
      );
    }
    setNavState(resolved);
  };

  const selectTab = (id: string) => {
    if (id === "home") setNav({ screen: "home" });
    else setNav(navByTabRef.current[id] ?? { screen: "project", projectId: id as Id<"projects">, view: "canvas" });
  };

  const closeTab = (id: string) => {
    const current = tabsRef.current;
    const index = current.findIndex((t) => t.id === id);
    setTabs(current.filter((t) => t.id !== id));
    delete navByTabRef.current[id];
    if (navRef.current.screen === "project" && navRef.current.projectId === id) {
      const neighbor = current[index + 1] ?? current[index - 1];
      if (neighbor) selectTab(neighbor.id);
      else setNav({ screen: "home" });
    }
  };

  const cycleTab = (dir: 1 | -1) => {
    const order = ["home", ...tabsRef.current.map((t) => t.id)];
    const from = navRef.current.screen === "project" ? (navRef.current.projectId as string) : "home";
    const i = order.indexOf(from);
    selectTab(order[(i + dir + order.length) % order.length]);
  };

  useEffect(() => saveTabs(tabs, activeId), [tabs, activeId]);

  // A deep-linked or restored project gets its tab on first render.
  useEffect(() => {
    if (nav.screen === "project") {
      const id = nav.projectId as string;
      setTabs((t) =>
        t.some((tab) => tab.id === id)
          ? t
          : [...t, { id, name: getRecents().find((r) => r.id === id)?.name ?? "Project" }]
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ⌃Tab / ⌃⇧Tab and ⌘⇧[ / ⌘⇧] cycle tabs (the browser/Figma idiom; ⌘1/⌘2
  // stay with Canvas/Prototype).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.metaKey && e.key === "Tab") {
        e.preventDefault();
        cycleTab(e.shiftKey ? -1 : 1);
      } else if (e.metaKey && e.shiftKey && (e.key === "[" || e.key === "{" || e.key === "]" || e.key === "}")) {
        e.preventDefault();
        cycleTab(e.key === "[" || e.key === "{" ? -1 : 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tabStrip = (
    <TabBar
      tabs={tabs}
      active={activeId}
      onSelect={selectTab}
      onClose={closeTab}
    />
  );
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

  // Native menu bar: navigation actions land here; view-local ones (zoom,
  // overlays) re-broadcast as window events for whichever surface is mounted.
  useEffect(() => {
    applyStoredPreviewAppearance();
    if (!window.commons) return;
    window.commons.setMenuRecents(getRecents());
    return window.commons.onMenuAction((action) => {
      switch (action.type) {
        case "new-project":
          setNav({ screen: "home" });
          break;
        case "open-project":
          setNav({ screen: "project", projectId: action.projectId as Id<"projects">, view: "canvas" });
          break;
        case "set-view":
          setNav((prev) => (prev.screen === "project" ? { ...prev, view: action.view } : prev));
          break;
        case "cycle-tab":
          cycleTab(action.dir);
          break;
        default:
          window.dispatchEvent(new CustomEvent("commons:menu", { detail: action }));
      }
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

  // A stored session validating (me === undefined) is almost certainly about
  // to succeed — hold a quiet blank beat instead of flashing the sign-in
  // card at every launch. SignIn renders only with no session or a dead one.
  if (session && me === undefined) {
    return <div className="center-screen" />;
  }
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
        <ProjectView
          key={nav.projectId}
          me={me}
          nav={nav}
          setNav={setNav}
          tabStrip={tabStrip}
          onProjectName={(id, name) => setTabs((t) => t.map((x) => (x.id === id ? { ...x, name } : x)))}
          onSignOut={doSignOut}
        />
        <CommandPalette me={me} setNav={setNav} />
        <UpdateChip />
      </>
    );
  }

  return (
    <>
      <ProjectList me={me} setNav={setNav} onSignOut={doSignOut} tabStrip={tabStrip} />
      <ShortcutsHelp />
      <Welcome name={me.name} />
      <CommandPalette me={me} setNav={setNav} />
      <UpdateChip />
    </>
  );
}
