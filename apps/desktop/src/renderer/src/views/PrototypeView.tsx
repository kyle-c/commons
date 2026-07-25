import { useEffect, useState } from "react";
import type { Doc, Id } from "@commons/backend/convex/_generated/dataModel";
import type { DevServerStatus } from "@commons/shared";
import { resolveFrameUrl } from "../lib/frameUrl";
import { registerShortcut } from "../lib/shortcuts";
import UserTests from "./UserTests";
import Icon, { type IconName } from "../components/icons";

// height > 0 marks a framed device — "Open in browser" wraps those in the
// device-sized preview harness so the browser keeps the form factor.
const DEVICES = [
  { label: "iPhone · 390", icon: "smartphone" as IconName, width: 390, height: 844 },
  { label: "iPad · 834", icon: "tablet" as IconName, width: 834, height: 1194 },
  { label: "Desktop · 1280", icon: "monitor" as IconName, width: 1280, height: 0 },
  { label: "Fill the window", icon: "maximize" as IconName, width: 0, height: 0 },
] as const;

export default function PrototypeView({
  frames,
  devStatus,
  previewUrl,
  viewerHasRepo,
  repoHolderNames,
  project,
  me,
  onShowHeatmap,
  onSendToAgent,
  onOpenSetup,
}: {
  frames: Doc<"frames">[];
  devStatus: DevServerStatus;
  previewUrl?: string | null;
  viewerHasRepo?: boolean;
  repoHolderNames?: string[];
  project: Doc<"projects">;
  me: Doc<"users">;
  onShowHeatmap?: (testId: Id<"tests">) => void;
  /** #5: launch an agent draft from a failing test task. */
  onSendToAgent?: (title: string, prompt: string, routePath?: string) => void;
  onOpenSetup?: () => void;
}) {
  const routes = frames.filter((f) => f.kind === "route");
  const [routePath, setRoutePath] = useState(routes[0]?.routePath ?? "/");
  const [chosenDevice, setDevice] = useState<(typeof DEVICES)[number] | null>(null);
  const [testsOpen, setTestsOpen] = useState(false);
  // Route drawer: with real projects at 30+ screens, a native select buried
  // them — a grouped, always-visible list reads like the canvas's sections.
  const [drawerOpen, setDrawerOpen] = useState(true);
  useEffect(
    () => registerShortcut("u", () => setTestsOpen((open) => !open), { description: "User tests" }),
    []
  );
  // Mobile projects (phone-sized frames) default to the iPhone preset.
  const device =
    chosenDevice ?? (routes.length > 0 && routes.every((f) => f.width <= 500) ? DEVICES[0] : DEVICES[3]);

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
          className={`btn ghost ${drawerOpen ? "active" : ""}`}
          title="Screens"
          onClick={() => setDrawerOpen((o) => !o)}
        >
          <Icon name="list" />
          <span className="proto-current">{routes.find((f) => (f.routePath ?? "/") === routePath)?.title ?? routePath}</span>
        </button>
        <div className="seg">
          {DEVICES.map((d) => (
            <button
              key={d.label}
              className={device.label === d.label ? "on" : ""}
              aria-label={d.label}
              title={d.label}
              onClick={() => setDevice(d)}
            >
              <Icon name={d.icon} />
            </button>
          ))}
        </div>
        <span className="spacer" style={{ flex: 1 }} />
        <button
          className={`btn ghost ${testsOpen ? "active" : ""}`}
          title="Task-based usability tests, shareable by link (U)"
          onClick={() => setTestsOpen((open) => !open)}
        >
          <Icon name="flask" /> User tests
        </button>
        {source && !source.live && (
          <span className="badge" title="Rendered from the deployed preview">
            preview
          </span>
        )}
        {url && (
          <button
            className="btn ghost"
            title={device.height ? `Opens framed at ${device.width}×${device.height}` : "Opens the raw app"}
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
            Open in browser ↗
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
          onOpenSetup={onOpenSetup}
        />
      )}
      <div className="proto-body">
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
        {url ? (
          <div className="proto-device" style={device.width ? { width: device.width } : { flex: 1 }}>
            {!loaded && <div className="frame-booting" />}
            <iframe
              src={url}
              title="Prototype"
              className={loaded ? "loaded" : ""}
              onLoad={() => setLoadedUrl(url)}
            />
          </div>
        ) : (
          <div className="center-screen hint">
            {devStatus.state === "starting"
              ? "Dev server starting…"
              : devStatus.state === "error"
                ? devStatus.message
                : viewerHasRepo
                  ? "Dev server stopped — set a preview URL as a fallback"
                  : repoHolderNames && repoHolderNames.length > 0
                    ? `Waiting for a preview — ask ${repoHolderNames[0]} to publish one`
                    : "Waiting for a preview — ask a teammate with the repo to publish one"}
          </div>
        )}
      </div>
      </div>
    </div>
  );
}
