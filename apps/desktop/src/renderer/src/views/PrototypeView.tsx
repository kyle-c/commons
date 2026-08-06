import { useEffect, useState } from "react";
import type { Doc, Id } from "@commons/backend/convex/_generated/dataModel";
import type { DevServerStatus } from "@commons/shared";
import { resolveFrameUrl } from "../lib/frameUrl";
import { registerShortcut } from "../lib/shortcuts";
import UserTests from "./UserTests";
import Icon, { type IconName } from "../components/icons";
import PreviewAppearanceButton from "../components/PreviewAppearanceButton";

// height > 0 marks a framed device — "Open in browser" wraps those in the
// device-sized preview harness so the browser keeps the form factor.
// Exported: the titlebar's view switcher owns device selection now.
export const DEVICES = [
  { label: "iPhone · 390", icon: "smartphone" as IconName, width: 390, height: 844 },
  { label: "iPad · 834", icon: "tablet" as IconName, width: 834, height: 1194 },
  { label: "Desktop · 1280", icon: "monitor" as IconName, width: 1280, height: 0 },
  { label: "Fill the window", icon: "maximize" as IconName, width: 0, height: 0 },
] as const;
export type ProtoDevice = (typeof DEVICES)[number];

export default function PrototypeView({
  frames,
  devStatus,
  previewUrl,
  viewerHasRepo,
  selfHasRepoElsewhere,
  repoHolderNames,
  project,
  me,
  onShowHeatmap,
  onSendToAgent,
  device,
  notes,
}: {
  frames: (Doc<"frames"> & { snapshotUrl?: string | null })[];
  devStatus: DevServerStatus;
  previewUrl?: string | null;
  viewerHasRepo?: boolean;
  /** The viewer holds this repo, just not on this machine. */
  selfHasRepoElsewhere?: boolean;
  repoHolderNames?: string[];
  project: Doc<"projects">;
  me: Doc<"users">;
  onShowHeatmap?: (testId: Id<"tests">) => void;
  /** #5: launch an agent draft from a failing test task. */
  onSendToAgent?: (title: string, prompt: string, routePath?: string) => void;
  /** Chosen in the titlebar's split view switcher. */
  device: ProtoDevice;
  /** Approved design notes, keyed by routePath — shown contextually beside
      the running screen. Deliberately absent from the tester harness: a
      tester who reads the designer's rationale is no longer a test. */
  notes?: Record<string, { text: string; inferred: boolean }[]>;
}) {
  const routes = frames.filter((f) => f.kind === "route");
  const [routePath, setRoutePath] = useState(routes[0]?.routePath ?? "/");
  const [testsOpen, setTestsOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(true);
  const routeNotes = notes?.[routePath] ?? [];
  /**
   * PRO-3: a Figma-backed project can flip the stage to the Figma prototype.
   * The embed needs no token — Figma's own viewer handles auth inside the
   * frame — so, like the canvas import, the rest of the app never holds
   * anything. Offered only when the project has a recorded file, and never
   * as the default: the running app is the prototype; this is the sketch.
   */
  const [figmaMode, setFigmaMode] = useState(false);
  const figmaEmbedUrl = project.figmaFileKey
    ? `https://embed.figma.com/proto/${encodeURIComponent(project.figmaFileKey)}?embed-host=commons&footer=false`
    : null;
  // Route drawer: with real projects at 30+ screens, a native select buried
  // them — a grouped, always-visible list reads like the canvas's sections.
  const [drawerOpen, setDrawerOpen] = useState(true);
  useEffect(
    () => registerShortcut("u", () => setTestsOpen((open) => !open), { description: "User tests" }),
    []
  );
  const source = resolveFrameUrl(routePath, devStatus, previewUrl);
  const url = source?.url ?? null;
  // Route/device switches keep the stage calm: shimmer under the incoming
  // iframe, fade it in on load — no white flash between screens.
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const loaded = url !== null && loadedUrl === url;

  return (
    <div className="proto">
      <div className="proto-toolbar">
        <button
          className={`btn ghost icon-btn ${drawerOpen ? "active" : ""}`}
          aria-label="Screens"
          title="Screens"
          onClick={() => setDrawerOpen((o) => !o)}
        >
          <Icon name="list" />
        </button>
        {/* Where you are, address-bar style: screen name plus its path, the
            same pairing the drawer rows and frame headers use. A bare "/"
            read as a mystery glyph. */}
        <span className="proto-address" title="Current screen">
          <span className="pa-name">
            {routes.find((f) => (f.routePath ?? "/") === routePath)?.title ?? "Screen"}
          </span>
          <span className="pa-path">{routePath}</span>
        </span>
        <span className="spacer" style={{ flex: 1 }} />
        {figmaEmbedUrl && (
          <button
            className={`btn ghost ${figmaMode ? "active" : ""}`}
            title="The Figma prototype for this project, embedded"
            onClick={() => setFigmaMode((m) => !m)}
          >
            <Icon name="image" /> Figma
          </button>
        )}
        {url && !figmaMode && project.supportsDarkMode && <PreviewAppearanceButton />}
        {routeNotes.length > 0 && (
          <button
            className={`btn ghost icon-btn ${notesOpen ? "active" : ""}`}
            aria-label="Design notes"
            title="The approved rationale for this screen"
            onClick={() => setNotesOpen((o) => !o)}
          >
            <Icon name="pen" />
          </button>
        )}
        <button
          className={`btn ghost ${testsOpen ? "active" : ""}`}
          title="Task-based usability tests, shareable by link (U)"
          onClick={() => setTestsOpen((open) => !open)}
        >
          <Icon name="flask" /> Tests
        </button>
        {source && !source.live && (
          <span className="badge" title="Rendered from the deployed preview">
            preview
          </span>
        )}
        {url && (
          <button
            className="btn ghost icon-btn"
            aria-label="Open in your browser"
            title={device.height ? `Open in your browser, framed at ${device.width}×${device.height}` : "Open in your browser"}
            onClick={async () => {
              if (!window.commons) {
                window.open(url);
                return;
              }
              // Carry the form factor into the browser: framed devices open
              // through the harness, desktop/fill open the raw URL.
              const target = device.height
                ? await window.commons.wrapPreviewUrl(url, {
                    width: device.width,
                    height: device.height,
                    title: routes.find((f) => f.routePath === routePath)?.title ?? "Prototype",
                  })
                : url;
              await window.commons.openExternal(target);
            }}
          >
            <Icon name="globe" />
          </button>
        )}
      </div>
      {testsOpen && (
        <UserTests
          project={project}
          me={me}
          frames={frames}
          onShowHeatmap={onShowHeatmap}
          onSendToAgent={onSendToAgent}
          onClose={() => setTestsOpen(false)}
        />
      )}
      <div className="proto-body">
        {notesOpen && routeNotes.length > 0 && (
          <div className="proto-notes">
            {routeNotes.map((note, i) => (
              <div key={i} className="frame-note">
                {note.text}
                {note.inferred && (
                  <span className="citation inferred" title="No evidence in the record. The designer approved this as their read">
                    inferred
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
        {drawerOpen && (
          <div className="route-drawer">
            {(() => {
              const groups = new Map<string, Doc<"frames">[]>();
              for (const frame of routes) {
                const key = frame.section ?? "";
                if (!groups.has(key)) groups.set(key, []);
                groups.get(key)!.push(frame);
              }
              return [...groups.entries()].map(([section, sectionFrames]) => (
                <div key={section || "ungrouped"}>
                  {section && <div className="pop-section">{section}</div>}
                  {sectionFrames.map((frame) => (
                    <button
                      key={frame._id}
                      className={`route-row ${(frame.routePath ?? "/") === routePath ? "on" : ""}`}
                      onClick={() => setRoutePath(frame.routePath ?? "/")}
                    >
                      <span className="route-row-title">{frame.title}</span>
                      <span className="route-row-path">{frame.routePath}</span>
                    </button>
                  ))}
                </div>
              ));
            })()}
          </div>
        )}
      <div className="proto-stage">
        {(() => {
          if (figmaMode && figmaEmbedUrl)
            return (
              <div className="proto-device" style={{ flex: 1 }}>
                <iframe src={figmaEmbedUrl} title="Figma prototype" className="loaded" allowFullScreen />
              </div>
            );
          if (url)
            return (
              <div className="proto-device" style={device.width ? { width: device.width } : { flex: 1 }}>
                {!loaded && <div className="frame-booting" />}
                <iframe
                  src={url}
                  title="Prototype"
                  className={loaded ? "loaded" : ""}
                  onLoad={() => setLoadedUrl(url)}
                />
              </div>
            );
          const hint =
            devStatus.state === "starting"
              ? "Dev server starting…"
              : devStatus.state === "error"
                ? devStatus.message
                : viewerHasRepo
                  ? "Dev server stopped — set a preview URL as a fallback"
                  : selfHasRepoElsewhere
                    ? "Your working copy is on another machine — locate or clone the repo here, or set a preview URL"
                    : repoHolderNames && repoHolderNames.length > 0
                      ? `Waiting for a preview — ask ${repoHolderNames[0]} to publish one`
                      : "Waiting for a preview — ask a teammate with the repo to publish one";
          // No live URL: the last snapshot beats an empty stage. Static, but
          // it keeps the prototype browsable from any machine.
          const current = routes.find((f) => (f.routePath ?? "/") === routePath);
          if (current?.snapshotUrl)
            return (
              <div
                className="proto-device proto-snapshot"
                style={device.width ? { width: device.width } : { flex: 1 }}
              >
                <img src={current.snapshotUrl} alt={current.title} />
                <div className="proto-snapshot-note">Snapshot · {hint}</div>
              </div>
            );
          return <div className="center-screen hint">{hint}</div>;
        })()}
      </div>
      </div>
    </div>
  );
}
