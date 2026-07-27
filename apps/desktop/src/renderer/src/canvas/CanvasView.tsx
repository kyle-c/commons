import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@commons/backend/convex/_generated/api";
import type { Doc, Id } from "@commons/backend/convex/_generated/dataModel";
import type { DevServerStatus } from "@commons/shared";
import type { ThreadWithMessages } from "../comments/types";
import Composer from "../comments/Composer";
import ThreadPanel from "../comments/ThreadPanel";
import Minimap from "./Minimap";
import { initials } from "../lib/session";
import { resolveFrameUrl } from "../lib/frameUrl";
import { registerShortcut } from "../lib/shortcuts";
import Icon from "../components/icons";
import PreviewAppearanceButton from "../components/PreviewAppearanceButton";

interface Viewport {
  x: number;
  y: number;
  scale: number;
}

interface Draft {
  frameId?: Id<"frames">;
  fx?: number;
  fy?: number;
  canvasX?: number;
  canvasY?: number;
  screenX: number;
  screenY: number;
}

interface Props {
  me: Doc<"users">;
  projectId: Id<"projects">;
  frames: (Doc<"frames"> & { snapshotUrl?: string | null; snapshotAt?: number | null })[];
  threads: ThreadWithMessages[];
  users: Doc<"users">[];
  /** Who can be @mentioned here — members only on private projects. */
  mentionUsers?: Doc<"users">[];
  devStatus: DevServerStatus;
  /** Deployed preview base URL — frame fallback when no local dev server. */
  previewUrl?: string | null;
  /** Whether this user has a working copy — empty states differ per persona. */
  viewerHasRepo?: boolean;
  /** The viewer holds this repo, just not on this machine. */
  selfHasRepoElsewhere?: boolean;
  /** Teammates (other than the viewer) who have live frames. */
  repoHolderNames?: string[];
  initialThreadId?: Id<"threads">;
  initialFrameId?: Id<"frames">;
  /** Bumped per frame when an agent finishes editing — remounts that frame's iframe. */
  frameReloadTokens?: Record<string, number>;
  onSendToAgent?: (thread: ThreadWithMessages) => void;
  /** Re-derive the section layout from the repo and move frames into it. */
  onTidy?: () => void;
  /** The project's /p/<token> page when shared — thread panels offer web links. */
  webLinkBase?: string;
  /** Test-click overlay: dots drawn on frames whose route matches. Coordinates
   *  are normalized by the tester's viewport width, so they scale by frame width. */
  heatmap?: {
    title: string;
    clicksByRoute: Record<string, { fx: number; fy: number; interactive: boolean }[]>;
    onClear: () => void;
  };
  /** Approved design-rationale annotations (NAR-2) — the Notes layer. */
  annotations?: { _id: string; frameId?: string | null; text: string; inferred: boolean }[];
}

/**
 * Multiplayer cursors as an isolated subscriber: cursor writes land every
 * ~120ms while a teammate moves, and before this split every write
 * re-rendered every frame on the canvas.
 */
function CursorLayer({ me, projectId, scale }: { me: Doc<"users">; projectId: Id<"projects">; scale: number }) {
  const cursors = useQuery(api.presence.cursorsInProject, { projectId, userId: me._id }) ?? [];
  // Re-filter periodically so idle teammates' cursors fade even when no new
  // cursor writes arrive to re-run the query.
  const [, tick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => tick((t) => t + 1), 5_000);
    return () => clearInterval(interval);
  }, []);
  const live = cursors.filter((c) => c.userId !== me._id && Date.now() - c.updatedAt < 10_000);
  return (
    <>
      {live.map((cursor) => (
        <div
          key={cursor.userId}
          className="presence-cursor"
          style={{ left: cursor.x, top: cursor.y, transform: `scale(${1 / scale})`, transformOrigin: "0 0" }}
        >
          <svg width="14" height="16" viewBox="0 0 14 16">
            <path d="M1 1 L13 7.5 L7.5 9 L4.5 15 Z" fill={cursor.avatarColor} stroke="#1a1b17" strokeWidth="1" />
          </svg>
          <span className="tag" style={{ background: cursor.avatarColor }}>
            {cursor.name.split(" ")[0]}
          </span>
        </div>
      ))}
    </>
  );
}

/**
 * Reopening a project (tab switch, back-and-forth) restores the canvas
 * exactly where it was instead of re-fitting — per-machine, per-session.
 */
const savedViewports = new Map<string, Viewport>();

/** "/pay/[id]" (or "/pay/:id") matches "/pay/123" — same rule as the tester harness. */
function routeMatches(pattern: string, path: string): boolean {
  const norm = (s: string) => ("/" + s).replace(/\/+/g, "/").replace(/\/$/, "") || "/";
  const p = norm(pattern).split("/");
  const a = norm(path).split("/");
  if (p.length !== a.length) return false;
  return p.every((seg, i) => (seg.startsWith("[") || seg.startsWith(":") ? a[i].length > 0 : seg === a[i]));
}

type CanvasFrame = Props["frames"][number];

/**
 * The frames themselves, memoized: nothing in here reads the viewport, so
 * pan/zoom re-renders (60/s during a gesture) skip this whole subtree — the
 * stage transform moves, the frames don't reconcile. Handlers arrive as
 * stable wrappers so the memo actually holds.
 */
const FrameLayer = memo(function FrameLayer({
  frames,
  localPos,
  focusedFrame,
  openCounts,
  devStatus,
  previewUrl,
  frameReloadTokens,
  loadedFrames,
  heatmap,
  commentMode,
  viewerHasRepo,
  selfHasRepoElsewhere,
  repoHolderNames,
  onFrameDrag,
  onShieldDown,
  onLoaded,
}: {
  frames: CanvasFrame[];
  localPos: Record<string, { x: number; y: number }>;
  focusedFrame: Id<"frames"> | null;
  openCounts: Record<string, number>;
  devStatus: DevServerStatus;
  previewUrl?: string | null;
  frameReloadTokens?: Record<string, number>;
  loadedFrames: Record<string, boolean>;
  heatmap?: Props["heatmap"];
  commentMode: boolean;
  viewerHasRepo?: boolean;
  selfHasRepoElsewhere?: boolean;
  repoHolderNames?: string[];
  onFrameDrag: (frame: Doc<"frames">, e: React.MouseEvent) => void;
  onShieldDown: (frame: Doc<"frames">, e: React.MouseEvent) => void;
  onLoaded: (loadKey: string) => void;
}) {
  return (
    <>
      {frames.map((frame) => {
        const pos = localPos[frame._id] ?? { x: frame.x, y: frame.y };
        const focused = focusedFrame === frame._id;
        const openCount = openCounts[frame._id] ?? 0;
        const source = frame.kind === "route" ? resolveFrameUrl(frame.routePath, devStatus, previewUrl) : null;
        const url = source?.url ?? null;
        return (
          <div
            key={frame._id}
            className={`frame ${focused ? "focused" : ""}`}
            style={{ left: pos.x, top: pos.y, width: frame.width, height: frame.height + 30 }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="frame-header" onMouseDown={(e) => onFrameDrag(frame, e)}>
              <span>{frame.title}</span>
              <span className="route">{frame.routePath}</span>
              {source && !source.live && (
                <span className="badge" title="Rendered from the deployed preview — locate the repo for a live dev server">
                  preview
                </span>
              )}
              <span style={{ flex: 1 }} />
              {openCount > 0 && <span className="badge comments">{openCount}</span>}
            </div>
            <div className="frame-body">
              {url ? (
                (() => {
                  const loadKey = `${frame._id}:${frameReloadTokens?.[frame._id] ?? 0}`;
                  const loaded = loadedFrames[loadKey] === true;
                  return (
                    <>
                      {!loaded &&
                        (frame.snapshotUrl ? (
                          <img className="frame-underlay" src={frame.snapshotUrl} alt="" />
                        ) : (
                          <div className="frame-booting" />
                        ))}
                      <iframe
                        key={loadKey}
                        className={loaded ? "loaded" : ""}
                        src={url}
                        title={frame.title}
                        onLoad={() => onLoaded(loadKey)}
                      />
                    </>
                  );
                })()
              ) : frame.snapshotUrl ? (
                // SNAP-3 fallback: last captured state beats an empty box.
                <img className="frame-snapshot" src={frame.snapshotUrl} alt={frame.title} title="Snapshot — no live preview right now" />
              ) : (
                <div className="frame-placeholder">
                  {frame.kind === "figma"
                    ? "Figma frames coming soon"
                    : devStatus.state === "starting"
                      ? "Dev server starting…"
                      : devStatus.state === "error"
                        ? devStatus.message
                        : viewerHasRepo
                          ? "Dev server stopped — set a preview URL as a fallback"
                          : selfHasRepoElsewhere
                            ? "Your working copy is on another machine — locate or clone the repo here"
                            : repoHolderNames && repoHolderNames.length > 0
                              ? `Waiting for a preview — ask ${repoHolderNames[0]} to publish one`
                              : "Waiting for a preview — ask a teammate with the repo to publish one"}
                </div>
              )}
              {heatmap && frame.routePath && (
                <div className="heatmap-layer">
                  {Object.entries(heatmap.clicksByRoute)
                    .filter(([route]) => routeMatches(frame.routePath!, route))
                    .flatMap(([route, clicks]) =>
                      clicks.map((click, i) => (
                        <span
                          key={`${route}-${i}`}
                          className={`heatmap-dot ${click.interactive ? "" : "miss"}`}
                          style={{ left: click.fx * frame.width, top: click.fy * frame.width }}
                        />
                      ))
                    )}
                </div>
              )}
              {!focused && url && (
                <div
                  className="frame-shield"
                  title="Click to interact with this screen"
                  onMouseDown={(e) => onShieldDown(frame, e)}
                />
              )}
              {commentMode && <div className="frame-shield" onMouseDown={(e) => onShieldDown(frame, e)} />}
            </div>
          </div>
        );
      })}
    </>
  );
});

export default function CanvasView({
  me,
  projectId,
  frames,
  threads,
  users,
  mentionUsers,
  devStatus,
  previewUrl,
  viewerHasRepo,
  selfHasRepoElsewhere,
  repoHolderNames,
  initialThreadId,
  initialFrameId,
  frameReloadTokens,
  onSendToAgent,
  onTidy,
  heatmap,
  webLinkBase,
  annotations,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [vp, setVp] = useState<Viewport>(() => savedViewports.get(projectId) ?? { x: 80, y: 80, scale: 0.3 });
  const vpRef = useRef(vp);
  vpRef.current = vp;
  useEffect(() => {
    return () => {
      savedViewports.set(projectId, vpRef.current);
    };
  }, [projectId]);

  const [commentMode, setCommentMode] = useState(false);
  // Notes layer: on by default — the annotations are curated, that's the point.
  const [notesOn, setNotesOn] = useState(true);
  // Perceived speed: keys are `${frameId}:${reloadToken}` so a reload shows
  // the previous pixels (snapshot underlay) until the fresh iframe paints.
  const [loadedFrames, setLoadedFrames] = useState<Record<string, boolean>>({});
  const [focusedFrame, setFocusedFrame] = useState<Id<"frames"> | null>(null);
  const [selectedThread, setSelectedThread] = useState<Id<"threads"> | null>(initialThreadId ?? null);
  const [draft, setDraft] = useState<Draft | null>(null);
  // Optimistic frame positions while dragging (and until the mutation round-trips).
  const [localPos, setLocalPos] = useState<Record<string, { x: number; y: number }>>({});

  const createThread = useMutation(api.comments.createThread);
  const moveFrame = useMutation(api.projects.moveFrame);
  // A restored viewport skips the initial fit — unless a deep link targets
  // a specific frame, which still deserves the centered landing.
  const didFit = useRef(savedViewports.has(projectId) && !initialFrameId);
  const [fitRetry, forceRender] = useState(0);

  // Multiplayer cursors: broadcast mine (throttled); teammates render in
  // CursorLayer so their churn never touches this tree.
  const moveCursor = useMutation(api.presence.moveCursor);
  const lastCursorSend = useRef(0);
  const cursorTrailing = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onCursorMove = (e: React.MouseEvent) => {
    const send = (clientX: number, clientY: number) => {
      lastCursorSend.current = Date.now();
      const p = screenToCanvas(clientX, clientY);
      void moveCursor({ userId: me._id, projectId, x: p.x, y: p.y });
    };
    if (Date.now() - lastCursorSend.current >= 120) {
      send(e.clientX, e.clientY);
    } else if (!cursorTrailing.current) {
      const { clientX, clientY } = e;
      cursorTrailing.current = setTimeout(() => {
        cursorTrailing.current = null;
        send(clientX, clientY);
      }, 130);
    }
  };
  useEffect(() => () => {
    if (cursorTrailing.current) clearTimeout(cursorTrailing.current);
  }, []);

  const framePos = (frame: Doc<"frames">) => localPos[frame._id] ?? { x: frame.x, y: frame.y };

  /**
   * Commanded viewport moves (⌘±, Fit) glide instead of snapping — a short
   * tween keeps spatial context. Direct manipulation (wheel, pinch, drag)
   * stays 1:1 and cancels any glide in flight.
   */
  const vpAnimation = useRef<number | null>(null);
  const cancelVpAnimation = () => {
    if (vpAnimation.current !== null) {
      cancelAnimationFrame(vpAnimation.current);
      vpAnimation.current = null;
    }
  };
  useEffect(() => cancelVpAnimation, []);
  const animateVp = (target: Viewport, duration = 220) => {
    // Reduced motion, or a hidden window where rAF never ticks: land instantly.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || document.visibilityState === "hidden") {
      setVp(target);
      return;
    }
    cancelVpAnimation();
    const from = vpRef.current;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const k = 1 - Math.pow(1 - t, 3);
      setVp({
        scale: from.scale + (target.scale - from.scale) * k,
        x: from.x + (target.x - from.x) * k,
        y: from.y + (target.y - from.y) * k,
      });
      vpAnimation.current = t < 1 ? requestAnimationFrame(step) : null;
    };
    vpAnimation.current = requestAnimationFrame(step);
  };

  /**
   * Anchor-pinned zoom tween: scale moves exponentially (zoom perception is
   * logarithmic — linear scale interpolation reads as a lurch) and x/y are
   * derived each step so the anchor point never drifts.
   */
  const animateZoom = (cx: number, cy: number, targetScale: number, duration = 240) => {
    const from = vpRef.current;
    const ratio = targetScale / from.scale;
    if (Math.abs(ratio - 1) < 1e-6) return;
    const finalVp = {
      scale: targetScale,
      x: cx - (cx - from.x) * ratio,
      y: cy - (cy - from.y) * ratio,
    };
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || document.visibilityState === "hidden") {
      setVp(finalVp);
      return;
    }
    cancelVpAnimation();
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const k = 1 - Math.pow(1 - t, 3);
      const s = from.scale * Math.pow(ratio, k);
      const m = s / from.scale;
      setVp({ scale: s, x: cx - (cx - from.x) * m, y: cy - (cy - from.y) * m });
      vpAnimation.current = t < 1 ? requestAnimationFrame(step) : null;
    };
    vpAnimation.current = requestAnimationFrame(step);
  };

  const fitTo = (target: Doc<"frames">[], maxScale = 1, animate = true) => {
    const el = wrapRef.current;
    if (!el || target.length === 0) return;
    const minX = Math.min(...target.map((f) => f.x));
    const minY = Math.min(...target.map((f) => f.y));
    const maxX = Math.max(...target.map((f) => f.x + f.width));
    const maxY = Math.max(...target.map((f) => f.y + f.height));
    const pad = 80;
    const scale = Math.max(
      0.05,
      Math.min((el.clientWidth - pad * 2) / (maxX - minX), (el.clientHeight - pad * 2) / (maxY - minY), maxScale)
    );
    const next = {
      scale,
      x: (el.clientWidth - (maxX - minX) * scale) / 2 - minX * scale,
      y: (el.clientHeight - (maxY - minY) * scale) / 2 - minY * scale,
    };
    if (animate) animateVp(next);
    else setVp(next);
  };
  const fitToContent = () => fitTo(frames);

  // "Overview" is a round trip, not a one-way fit: first press shows
  // everything, second press returns to where you were. Any direct
  // manipulation (wheel, drag) means you've picked a new spot, so the
  // return leg is cancelled and the toggle disarms.
  const [overviewFrom, setOverviewFrom] = useState<Viewport | null>(null);
  const overviewFromRef = useRef<Viewport | null>(null);
  overviewFromRef.current = overviewFrom;
  const toggleOverview = () => {
    const back = overviewFromRef.current;
    if (back) {
      setOverviewFrom(null);
      animateVp(back);
    } else {
      setOverviewFrom({ ...vpRef.current });
      fitToContent();
    }
  };

  // ⌘+/⌘− zoom the canvas around its center; ⌘0 fits to content. The app menu
  // drops Electron's chrome-zoom roles so these keys reach us (main/index.ts).
  const zoomBy = (factor: number) => {
    const el = wrapRef.current;
    if (!el) return;
    const scale = Math.min(2, Math.max(0.05, vpRef.current.scale * factor));
    animateZoom(el.clientWidth / 2, el.clientHeight / 2, scale);
  };
  const fitRef = useRef(toggleOverview);
  fitRef.current = toggleOverview;
  useEffect(() => {
    const unregister = [
      registerShortcut("=", () => zoomBy(1.25), { meta: true, description: "Zoom in" }),
      registerShortcut("+", () => zoomBy(1.25), { meta: true }), // ⌘⇧= on most layouts
      registerShortcut("-", () => zoomBy(0.8), { meta: true, description: "Zoom out" }),
      registerShortcut("0", () => fitRef.current(), { meta: true, description: "Overview (and back)" }),
    ];
    // View > Zoom In/Out/Fit — the menu shows the shortcuts but the keys
    // stay renderer-owned; menu clicks arrive as this event instead.
    const onMenu = (e: Event) => {
      const action = (e as CustomEvent).detail;
      if (action?.type !== "zoom") return;
      if (action.dir === "in") zoomBy(1.25);
      else if (action.dir === "out") zoomBy(0.8);
      else fitRef.current();
    };
    window.addEventListener("commons:menu", onMenu);
    return () => {
      unregister.forEach((fn) => fn());
      window.removeEventListener("commons:menu", onMenu);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Initial framing: center the deep-linked frame; otherwise land on the
  // first section at a legible zoom (the minimap + section labels handle
  // wayfinding to the rest — fit-everything is the explicit Fit/⌘0 action).
  const initialFit = () => {
    const first = frames[0];
    if (!first) return;
    let target: Doc<"frames">[];
    if (first.section) {
      target = frames.filter((f) => f.section === first.section);
    } else {
      // Sectionless canvas: roughly the first two rows.
      const minY = Math.min(...frames.map((f) => f.y));
      target = frames.filter((f) => f.y <= minY + first.height * 2.2);
    }
    fitTo(target, 0.6, false); // first paint lands framed, no glide
  };

  useEffect(() => {
    if (didFit.current || frames.length === 0 || !wrapRef.current) return;
    // In the browser web app the stylesheet can land after first render,
    // leaving the wrap unmeasured — retry until layout is real.
    if (wrapRef.current.clientWidth < 200 || wrapRef.current.clientHeight < 200) {
      const timer = setTimeout(() => forceRender((n) => n + 1), 120);
      return () => clearTimeout(timer);
    }
    didFit.current = true;
    const target = initialFrameId && frames.find((f) => f._id === initialFrameId);
    if (target) {
      const el = wrapRef.current;
      const scale = 0.5;
      setVp({
        scale,
        x: el.clientWidth / 2 - (target.x + target.width / 2) * scale,
        y: el.clientHeight / 2 - (target.y + target.height / 2) * scale,
      });
    } else {
      initialFit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frames, fitRetry]);

  // Wheel: two-finger pan, pinch/⌘ zoom around the cursor.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      cancelVpAnimation(); // the hand always wins over a glide
      if (overviewFromRef.current) setOverviewFrom(null);
      const v = vpRef.current;
      if (e.ctrlKey || e.metaKey) {
        const rect = el.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        const scale = Math.min(2, Math.max(0.05, v.scale * Math.exp(-e.deltaY * 0.01)));
        const k = scale / v.scale;
        setVp({ scale, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k });
      } else {
        setVp({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY });
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => registerShortcut("c", () => setCommentMode((m) => !m), { description: "Comment mode" }), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "TEXTAREA" || target.tagName === "INPUT") return;
      if (e.key === "Escape") {
        setCommentMode(false);
        setDraft(null);
        setFocusedFrame(null);
        setSelectedThread(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const screenToCanvas = (clientX: number, clientY: number) => {
    const rect = wrapRef.current!.getBoundingClientRect();
    const v = vpRef.current;
    return {
      x: (clientX - rect.left - v.x) / v.scale,
      y: (clientY - rect.top - v.y) / v.scale,
      screenX: clientX - rect.left,
      screenY: clientY - rect.top,
    };
  };

  const onBackgroundMouseDown = (e: React.MouseEvent) => {
    if (e.target !== e.currentTarget || e.button !== 0) return;
    if (commentMode) {
      const p = screenToCanvas(e.clientX, e.clientY);
      setDraft({ canvasX: p.x, canvasY: p.y, screenX: p.screenX, screenY: p.screenY });
      return;
    }
    setFocusedFrame(null);
    setSelectedThread(null);
    setDraft(null);
    cancelVpAnimation();
    if (overviewFromRef.current) setOverviewFrom(null);
    const start = { x: e.clientX, y: e.clientY, vx: vpRef.current.x, vy: vpRef.current.y };
    const move = (ev: MouseEvent) =>
      setVp({ ...vpRef.current, x: start.vx + ev.clientX - start.x, y: start.vy + ev.clientY - start.y });
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  // Double-click on empty canvas: zoom in around the cursor (Figma/Miro
  // convention); shift+double-click zooms back out. Comment mode keeps
  // clicks for pinning.
  const onBackgroundDoubleClick = (e: React.MouseEvent) => {
    if (e.target !== e.currentTarget || commentMode) return;
    const el = wrapRef.current;
    if (!el) return;
    if (overviewFromRef.current) setOverviewFrom(null);
    const rect = el.getBoundingClientRect();
    const scale = Math.min(2, Math.max(0.05, vpRef.current.scale * (e.shiftKey ? 1 / 1.6 : 1.6)));
    animateZoom(e.clientX - rect.left, e.clientY - rect.top, scale);
  };

  const startFrameDrag = (frame: Doc<"frames">, e: React.MouseEvent) => {
    if (commentMode || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const origin = framePos(frame);
    const start = { x: e.clientX, y: e.clientY };
    let latest = origin;
    const move = (ev: MouseEvent) => {
      const v = vpRef.current;
      latest = {
        x: origin.x + (ev.clientX - start.x) / v.scale,
        y: origin.y + (ev.clientY - start.y) / v.scale,
      };
      setLocalPos((prev) => ({ ...prev, [frame._id]: latest }));
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      moveFrame({ frameId: frame._id, x: latest.x, y: latest.y });
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const onFrameShieldMouseDown = (frame: Doc<"frames">, e: React.MouseEvent) => {
    e.stopPropagation();
    if (commentMode) {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const p = screenToCanvas(e.clientX, e.clientY);
      setDraft({
        frameId: frame._id,
        fx: (e.clientX - rect.left) / rect.width,
        fy: (e.clientY - rect.top) / rect.height,
        screenX: p.screenX,
        screenY: p.screenY,
      });
    } else {
      setFocusedFrame(frame._id);
    }
  };

  // Optimistic posting: the pin lands the moment you hit Comment; the
  // mutation catches up behind it. On failure the pin retracts and the
  // composer reopens at the same spot.
  const [pendingPin, setPendingPin] = useState<
    (Pick<Draft, "frameId" | "fx" | "fy" | "canvasX" | "canvasY"> & { threadId?: string }) | null
  >(null);
  useEffect(() => {
    if (pendingPin?.threadId && threads.some((t) => t._id === pendingPin.threadId)) setPendingPin(null);
  }, [threads, pendingPin]);

  const submitDraft = async (body: string, mentions: Id<"users">[]) => {
    if (!draft) return;
    const coords = {
      frameId: draft.frameId,
      fx: draft.fx,
      fy: draft.fy,
      canvasX: draft.canvasX,
      canvasY: draft.canvasY,
    };
    const restore = draft;
    setPendingPin(coords);
    setDraft(null);
    setCommentMode(false);
    try {
      const threadId = await createThread({ projectId, createdBy: me._id, body, mentions, ...coords });
      setPendingPin((p) => (p ? { ...p, threadId } : p));
      setSelectedThread(threadId);
    } catch {
      setPendingPin(null);
      setDraft(restore);
      alert("The comment didn't post — check your connection and try again.");
    }
  };

  const pinPosition = (thread: ThreadWithMessages): { x: number; y: number } | null => {
    if (thread.frameId) {
      const frame = frames.find((f) => f._id === thread.frameId);
      if (!frame) return null;
      const pos = framePos(frame);
      return { x: pos.x + (thread.fx ?? 0) * frame.width, y: pos.y + (thread.fy ?? 0) * frame.height };
    }
    return { x: thread.canvasX ?? 0, y: thread.canvasY ?? 0 };
  };

  const threadCountForFrame = (frameId: Id<"frames">) =>
    threads.filter((t) => t.frameId === frameId && !t.resolvedAt).length;

  // Stable inputs for the memoized FrameLayer: counts recompute only when
  // threads change; handlers are identity-stable wrappers over refs.
  const openCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const t of threads) {
      if (t.frameId && !t.resolvedAt) counts[t.frameId] = (counts[t.frameId] ?? 0) + 1;
    }
    return counts;
  }, [threads]);
  const frameHandlersRef = useRef({ drag: startFrameDrag, shield: onFrameShieldMouseDown });
  frameHandlersRef.current = { drag: startFrameDrag, shield: onFrameShieldMouseDown };
  const [stableFrameHandlers] = useState(() => ({
    onFrameDrag: (frame: Doc<"frames">, e: React.MouseEvent) => frameHandlersRef.current.drag(frame, e),
    onShieldDown: (frame: Doc<"frames">, e: React.MouseEvent) => frameHandlersRef.current.shield(frame, e),
    onLoaded: (loadKey: string) =>
      setLoadedFrames((prev) => (prev[loadKey] ? prev : { ...prev, [loadKey]: true })),
  }));

  const selected = threads.find((t) => t._id === selectedThread) ?? null;

  // Section regions: bounding box of each named section's frames (follows drags).
  const sectionBounds = new Map<string, { minX: number; minY: number; maxX: number; maxY: number }>();
  for (const frame of frames) {
    if (!frame.section) continue;
    const pos = framePos(frame);
    const b = sectionBounds.get(frame.section) ?? { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    b.minX = Math.min(b.minX, pos.x);
    b.minY = Math.min(b.minY, pos.y);
    b.maxX = Math.max(b.maxX, pos.x + frame.width);
    b.maxY = Math.max(b.maxY, pos.y + frame.height + 30);
    sectionBounds.set(frame.section, b);
  }
  const SECTION_PAD = 40;

  // Far zoom: frame headers are unreadable — show big titles instead.
  const farZoom = vp.scale < 0.25;

  const openPins = threads
    .filter((t) => !t.resolvedAt)
    .map((t) => pinPosition(t))
    .filter((p): p is { x: number; y: number } => p !== null);
  const wrapEl = wrapRef.current;
  const viewRect = wrapEl
    ? {
        x: -vp.x / vp.scale,
        y: -vp.y / vp.scale,
        width: wrapEl.clientWidth / vp.scale,
        height: wrapEl.clientHeight / vp.scale,
      }
    : null;

  return (
    <div
      ref={wrapRef}
      className={`canvas-wrap ${commentMode ? "commenting" : ""}`}
      onMouseDown={onBackgroundMouseDown}
      onDoubleClick={onBackgroundDoubleClick}
      onMouseMove={onCursorMove}
    >
      <div
        className="canvas-stage"
        style={{ transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.scale})` }}
      >
        {[...sectionBounds.entries()].map(([section, b]) => (
          <div key={section}>
            <div
              className="section-region"
              style={{
                left: b.minX - SECTION_PAD,
                top: b.minY - SECTION_PAD,
                width: b.maxX - b.minX + SECTION_PAD * 2,
                height: b.maxY - b.minY + SECTION_PAD * 2,
              }}
            />
            <div
              className="section-label"
              style={{
                left: b.minX - SECTION_PAD,
                top: b.minY - SECTION_PAD - 8,
                transform: `scale(${1 / vp.scale})`,
                transformOrigin: "0 100%",
              }}
            >
              {section}
            </div>
          </div>
        ))}

        <FrameLayer
          frames={frames}
          localPos={localPos}
          focusedFrame={focusedFrame}
          openCounts={openCounts}
          devStatus={devStatus}
          previewUrl={previewUrl}
          frameReloadTokens={frameReloadTokens}
          loadedFrames={loadedFrames}
          heatmap={heatmap}
          commentMode={commentMode}
          viewerHasRepo={viewerHasRepo}
          selfHasRepoElsewhere={selfHasRepoElsewhere}
          repoHolderNames={repoHolderNames}
          {...stableFrameHandlers}
        />

        {notesOn &&
          frames.map((frame) => {
            const notes = (annotations ?? []).filter((a) => a.frameId === frame._id);
            if (notes.length === 0) return null;
            const pos = framePos(frame);
            return (
              <div
                key={`notes-${frame._id}`}
                className="frame-notes"
                style={{ left: pos.x, top: pos.y + frame.height + 34, width: frame.width }}
                onMouseDown={(e) => e.stopPropagation()}
              >
                {notes.map((note) => (
                  <div key={note._id} className="frame-note">
                    {note.text}
                    {note.inferred && (
                      <span className="citation inferred" title="No evidence in the record. The designer approved this as their read">
                        inferred
                      </span>
                    )}
                  </div>
                ))}
              </div>
            );
          })}

        {threads.map((thread) => {
          const pos = pinPosition(thread);
          if (!pos) return null;
          const first = thread.messages[0];
          // Guests (web-share comments) have no author doc — use their name
          // and a stable neutral color instead of a "?" pin.
          const pinName = first?.author?.name ?? first?.guestName ?? "?";
          const pinColor = first?.author?.avatarColor ?? "#9d9da6";
          return (
            <button
              key={thread._id}
              className={`pin ${thread.resolvedAt ? "resolved" : ""} ${selectedThread === thread._id ? "selected" : ""}`}
              style={{
                left: pos.x,
                top: pos.y,
                transform: `scale(${1 / vp.scale}) translate(-4px, -24px)`,
                transformOrigin: "0 100%",
                background: thread.resolvedAt ? undefined : pinColor,
              }}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => setSelectedThread(thread._id)}
              title={pinName}
            >
              {initials(pinName)}
            </button>
          );
        })}

        {pendingPin &&
          (() => {
            const frame = pendingPin.frameId ? frames.find((f) => f._id === pendingPin.frameId) : undefined;
            const pos = frame
              ? {
                  x: framePos(frame).x + (pendingPin.fx ?? 0) * frame.width,
                  y: framePos(frame).y + (pendingPin.fy ?? 0) * frame.height,
                }
              : { x: pendingPin.canvasX ?? 0, y: pendingPin.canvasY ?? 0 };
            return (
              <span
                className="pin pending"
                style={{
                  left: pos.x,
                  top: pos.y,
                  transform: `scale(${1 / vp.scale}) translate(-4px, -24px)`,
                  transformOrigin: "0 100%",
                  background: me.avatarColor,
                }}
              >
                {initials(me.name)}
              </span>
            );
          })()}

        {farZoom &&
          frames.map((frame) => {
            const pos = framePos(frame);
            // Captions render at constant screen size (inverse-scaled), so
            // clamp to the frame's on-screen width or neighbors collide.
            const screenWidth = frame.width * vp.scale;
            if (screenWidth < 40) return null;
            const shortTitle = frame.title.includes(" / ") ? frame.title.split(" / ").pop()! : frame.title;
            return (
              <div
                key={`far-${frame._id}`}
                className="frame-farlabel"
                title={frame.title}
                style={{
                  // Caption below the frame (gap is constant on screen).
                  left: pos.x,
                  top: pos.y + frame.height + 30 + 8 / vp.scale,
                  transform: `scale(${1 / vp.scale})`,
                  transformOrigin: "0 0",
                  maxWidth: Math.max(44, screenWidth - 4),
                }}
              >
                {shortTitle}
              </div>
            );
          })}

        <CursorLayer me={me} projectId={projectId} scale={vp.scale} />
      </div>

      {draft && (
        <div
          style={{
            position: "absolute",
            left: Math.min(draft.screenX, (wrapRef.current?.clientWidth ?? 800) - 340),
            top: Math.min(draft.screenY, (wrapRef.current?.clientHeight ?? 600) - 220),
            width: 320,
            background: "var(--bg-panel)",
            border: "1px solid var(--border-default)",
            borderRadius: "var(--radius-lg)",
            boxShadow: "var(--shadow-panel)",
            zIndex: 25,
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <Composer
            users={mentionUsers ?? users}
            me={me}
            autoFocus
            placeholder="Start a thread… @ to mention"
            submitLabel="Comment"
            onSubmit={submitDraft}
            onCancel={() => setDraft(null)}
          />
        </div>
      )}

      {selected && (
        <div onMouseDown={(e) => e.stopPropagation()}>
          <ThreadPanel
            thread={selected}
            me={me}
            users={users}
            mentionUsers={mentionUsers ?? users}
            onClose={() => setSelectedThread(null)}
            onSendToAgent={onSendToAgent && (() => onSendToAgent(selected))}
            webLinkBase={webLinkBase}
          />
        </div>
      )}

      {heatmap && (
        <div className="heatmap-chip" onMouseDown={(e) => e.stopPropagation()}>
          <span>
            Clicks from “{heatmap.title}” — orange dots missed anything clickable
          </span>
          <button className="btn ghost" onClick={heatmap.onClear}>
            Clear
          </button>
        </div>
      )}

      {viewRect && frames.length > 0 && (
        <Minimap
          frames={frames.map((f) => ({ ...framePos(f), width: f.width, height: f.height + 30 }))}
          pins={openPins}
          viewRect={viewRect}
          onJump={(cx, cy) => {
            const el = wrapRef.current;
            if (!el) return;
            const v = vpRef.current;
            setVp({ scale: v.scale, x: el.clientWidth / 2 - cx * v.scale, y: el.clientHeight / 2 - cy * v.scale });
          }}
        />
      )}

      <div className="canvas-toolbar" onMouseDown={(e) => e.stopPropagation()}>
        <button
          className={`btn ghost ${commentMode ? "active" : ""}`}
          title="Comment mode (C)"
          onClick={() => setCommentMode((m) => !m)}
        >
          <Icon name="message" /> Comment
        </button>
        {(annotations?.length ?? 0) > 0 && (
          <button
            className={`btn ghost ${notesOn ? "active" : ""}`}
            title="Design notes: approved rationale under each screen"
            onClick={() => setNotesOn((on) => !on)}
          >
            <Icon name="pen" size={14} /> Notes
          </button>
        )}
        <button
          className={`btn ghost ${overviewFrom ? "active" : ""}`}
          onClick={toggleOverview}
          title={overviewFrom ? "Back to where you were (⌘0)" : "See everything, press again to come back (⌘0)"}
        >
          Overview
        </button>
        <PreviewAppearanceButton />
        {onTidy && (
          <button className="btn ghost" onClick={onTidy} title="Re-lay out frames by section (moves frames for everyone)">
            Tidy
          </button>
        )}
        <button className="btn ghost zoom-step" title="Zoom out (⌘−)" onClick={() => zoomBy(0.8)}>
          −
        </button>
        <span className="zoom" title="⌘0 fits to content">
          {Math.round(vp.scale * 100)}%
        </span>
        <button className="btn ghost zoom-step" title="Zoom in (⌘+)" onClick={() => zoomBy(1.25)}>
          +
        </button>
      </div>
    </div>
  );
}
