import { useEffect, useRef, useState } from "react";
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
  frames: Doc<"frames">[];
  threads: ThreadWithMessages[];
  users: Doc<"users">[];
  /** Who can be @mentioned here — members only on private projects. */
  mentionUsers?: Doc<"users">[];
  devStatus: DevServerStatus;
  /** Deployed preview base URL — frame fallback when no local dev server. */
  previewUrl?: string | null;
  /** Whether this user has a working copy — empty states differ per persona. */
  viewerHasRepo?: boolean;
  /** Teammates (other than the viewer) who have live frames. */
  repoHolderNames?: string[];
  initialThreadId?: Id<"threads">;
  initialFrameId?: Id<"frames">;
  /** Bumped per frame when an agent finishes editing — remounts that frame's iframe. */
  frameReloadTokens?: Record<string, number>;
  onSendToAgent?: (thread: ThreadWithMessages) => void;
  /** Re-derive the section layout from the repo and move frames into it. */
  onTidy?: () => void;
  /** Test-click overlay: dots drawn on frames whose route matches. Coordinates
   *  are normalized by the tester's viewport width, so they scale by frame width. */
  heatmap?: {
    title: string;
    clicksByRoute: Record<string, { fx: number; fy: number; interactive: boolean }[]>;
    onClear: () => void;
  };
}

/** "/pay/[id]" (or "/pay/:id") matches "/pay/123" — same rule as the tester harness. */
function routeMatches(pattern: string, path: string): boolean {
  const norm = (s: string) => ("/" + s).replace(/\/+/g, "/").replace(/\/$/, "") || "/";
  const p = norm(pattern).split("/");
  const a = norm(path).split("/");
  if (p.length !== a.length) return false;
  return p.every((seg, i) => (seg.startsWith("[") || seg.startsWith(":") ? a[i].length > 0 : seg === a[i]));
}

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
  repoHolderNames,
  initialThreadId,
  initialFrameId,
  frameReloadTokens,
  onSendToAgent,
  onTidy,
  heatmap,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [vp, setVp] = useState<Viewport>({ x: 80, y: 80, scale: 0.3 });
  const vpRef = useRef(vp);
  vpRef.current = vp;

  const [commentMode, setCommentMode] = useState(false);
  const [focusedFrame, setFocusedFrame] = useState<Id<"frames"> | null>(null);
  const [selectedThread, setSelectedThread] = useState<Id<"threads"> | null>(initialThreadId ?? null);
  const [draft, setDraft] = useState<Draft | null>(null);
  // Optimistic frame positions while dragging (and until the mutation round-trips).
  const [localPos, setLocalPos] = useState<Record<string, { x: number; y: number }>>({});

  const createThread = useMutation(api.comments.createThread);
  const moveFrame = useMutation(api.projects.moveFrame);
  const didFit = useRef(false);

  // Multiplayer cursors: broadcast mine (throttled), render teammates'.
  const moveCursor = useMutation(api.presence.moveCursor);
  const cursors = useQuery(api.presence.cursorsInProject, { projectId, userId: me._id }) ?? [];
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
  // Re-filter periodically so idle teammates' cursors fade even when no new
  // cursor writes arrive to re-run the query.
  const [, cursorTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => cursorTick((t) => t + 1), 5_000);
    return () => clearInterval(interval);
  }, []);
  const liveCursors = cursors.filter((c) => c.userId !== me._id && Date.now() - c.updatedAt < 10_000);

  const framePos = (frame: Doc<"frames">) => localPos[frame._id] ?? { x: frame.x, y: frame.y };

  const fitTo = (target: Doc<"frames">[], maxScale = 1) => {
    const el = wrapRef.current;
    if (!el || target.length === 0) return;
    const minX = Math.min(...target.map((f) => f.x));
    const minY = Math.min(...target.map((f) => f.y));
    const maxX = Math.max(...target.map((f) => f.x + f.width));
    const maxY = Math.max(...target.map((f) => f.y + f.height));
    const pad = 80;
    const scale = Math.min(
      (el.clientWidth - pad * 2) / (maxX - minX),
      (el.clientHeight - pad * 2) / (maxY - minY),
      maxScale
    );
    setVp({
      scale,
      x: (el.clientWidth - (maxX - minX) * scale) / 2 - minX * scale,
      y: (el.clientHeight - (maxY - minY) * scale) / 2 - minY * scale,
    });
  };
  const fitToContent = () => fitTo(frames);

  // ⌘+/⌘− zoom the canvas around its center; ⌘0 fits to content. The app menu
  // drops Electron's chrome-zoom roles so these keys reach us (main/index.ts).
  const zoomBy = (factor: number) => {
    const el = wrapRef.current;
    if (!el) return;
    const v = vpRef.current;
    const cx = el.clientWidth / 2;
    const cy = el.clientHeight / 2;
    const scale = Math.min(2, Math.max(0.05, v.scale * factor));
    const k = scale / v.scale;
    setVp({ scale, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k });
  };
  const fitRef = useRef(fitToContent);
  fitRef.current = fitToContent;
  useEffect(() => {
    const unregister = [
      registerShortcut("=", () => zoomBy(1.25), { meta: true, description: "Zoom in" }),
      registerShortcut("+", () => zoomBy(1.25), { meta: true }), // ⌘⇧= on most layouts
      registerShortcut("-", () => zoomBy(0.8), { meta: true, description: "Zoom out" }),
      registerShortcut("0", () => fitRef.current(), { meta: true, description: "Fit to content" }),
    ];
    return () => unregister.forEach((fn) => fn());
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
    fitTo(target, 0.6);
  };

  useEffect(() => {
    if (didFit.current || frames.length === 0 || !wrapRef.current) return;
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
  }, [frames]);

  // Wheel: two-finger pan, pinch/⌘ zoom around the cursor.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
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

  const submitDraft = async (body: string, mentions: Id<"users">[]) => {
    if (!draft) return;
    const threadId = await createThread({
      projectId,
      createdBy: me._id,
      body,
      mentions,
      frameId: draft.frameId,
      fx: draft.fx,
      fy: draft.fy,
      canvasX: draft.canvasX,
      canvasY: draft.canvasY,
    });
    setDraft(null);
    setCommentMode(false);
    setSelectedThread(threadId);
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

        {frames.map((frame) => {
          const pos = framePos(frame);
          const focused = focusedFrame === frame._id;
          const openCount = threadCountForFrame(frame._id);
          const source = frame.kind === "route" ? resolveFrameUrl(frame.routePath, devStatus, previewUrl) : null;
          const url = source?.url ?? null;
          return (
            <div
              key={frame._id}
              className={`frame ${focused ? "focused" : ""}`}
              style={{ left: pos.x, top: pos.y, width: frame.width, height: frame.height + 30 }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="frame-header" onMouseDown={(e) => startFrameDrag(frame, e)}>
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
                  <iframe key={frameReloadTokens?.[frame._id] ?? 0} src={url} title={frame.title} />
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
                    onMouseDown={(e) => onFrameShieldMouseDown(frame, e)}
                  />
                )}
                {commentMode && (
                  <div className="frame-shield" onMouseDown={(e) => onFrameShieldMouseDown(frame, e)} />
                )}
              </div>
            </div>
          );
        })}

        {threads.map((thread) => {
          const pos = pinPosition(thread);
          if (!pos) return null;
          const firstAuthor = thread.messages[0]?.author;
          return (
            <button
              key={thread._id}
              className={`pin ${thread.resolvedAt ? "resolved" : ""} ${selectedThread === thread._id ? "selected" : ""}`}
              style={{
                left: pos.x,
                top: pos.y,
                transform: `scale(${1 / vp.scale}) translate(-4px, -24px)`,
                transformOrigin: "0 100%",
                background: thread.resolvedAt ? undefined : firstAuthor?.avatarColor,
              }}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => setSelectedThread(thread._id)}
            >
              {initials(firstAuthor?.name ?? "?")}
            </button>
          );
        })}

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

        {liveCursors.map((cursor) => (
          <div
            key={cursor.userId}
            className="presence-cursor"
            style={{ left: cursor.x, top: cursor.y, transform: `scale(${1 / vp.scale})`, transformOrigin: "0 0" }}
          >
            <svg width="14" height="16" viewBox="0 0 14 16">
              <path d="M1 1 L13 7.5 L7.5 9 L4.5 15 Z" fill={cursor.avatarColor} stroke="#101012" strokeWidth="1" />
            </svg>
            <span className="tag" style={{ background: cursor.avatarColor }}>
              {cursor.name.split(" ")[0]}
            </span>
          </div>
        ))}
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
          💬 Comment
        </button>
        <button className="btn ghost" onClick={fitToContent} title="Fit to content">
          Fit
        </button>
        {onTidy && (
          <button className="btn ghost" onClick={onTidy} title="Re-lay out frames by section (moves frames for everyone)">
            Tidy
          </button>
        )}
        <span className="zoom">{Math.round(vp.scale * 100)}%</span>
      </div>
    </div>
  );
}
