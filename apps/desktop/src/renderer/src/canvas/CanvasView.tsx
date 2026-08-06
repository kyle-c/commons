import { Fragment, memo, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@commons/backend/convex/_generated/api";
import type { Doc, Id } from "@commons/backend/convex/_generated/dataModel";
import type { DevServerStatus } from "@commons/shared";
import type { ThreadWithMessages } from "../comments/types";
import Composer from "../comments/Composer";
import GuestComposer from "../comments/GuestComposer";
import { postGuestThread, storedGuestName } from "../lib/guestApi";
import ThreadPanel from "../comments/ThreadPanel";
import Minimap from "./Minimap";
import { initials, sessionToken } from "../lib/session";
import { resolveFrameUrl } from "../lib/frameUrl";
import { draftPreviewUrl } from "@commons/shared";
import { tidyPositions } from "../lib/frameLayout";
import { registerShortcut } from "../lib/shortcuts";
import Icon from "../components/icons";
import PreviewAppearanceButton from "../components/PreviewAppearanceButton";
import { burstEmoji } from "../lib/burst";
import { markFirst } from "../lib/firsts";
import { playPop } from "../lib/sounds";

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
  /**
   * Null in guest mode (/g/<token>), where there is no session at all.
   *
   * Everything that needs a viewer is a write — cursors, dragging frames,
   * starting a thread — so guest mode falls out of this one nullable rather
   * than a parallel read-only component. A second canvas implementation is
   * what the share page already was, and replacing it with another one would
   * have missed the point.
   */
  me: Doc<"users"> | null;
  /** Present in guest mode: enables commenting, with the token as credential. */
  guestToken?: string;
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
  /**
   * Flow view: when set, frames sit at these computed positions (drags are
   * disabled; the layout is derived, not owned) and flowEdges draw beneath
   * them. Everything else — pins, threads, zoom, guests — behaves as on the
   * canvas, which is the point of rendering flows with the same component.
   */
  positionOverride?: Record<string, { x: number; y: number }>;
  flowEdges?: {
    _id: string;
    fromFrameId: string;
    toFrameId: string;
    weight: number;
    label?: string;
    /** "tests" = walked by testers (weighted); "manual" = drawn by a person. */
    source?: "tests" | "manual" | "code";
  }[];
  /** Exploration layer (signed-in canvas only; absent in guest mode). */
  branchPreviewPattern?: string;
  reactions?: Record<string, { emoji: string; count: number; mine: boolean; fx?: number; fy?: number }[]>;
  votes?: Record<string, { count: number; mine: boolean }>;
  onReact?: (frameId: Id<"frames">, emoji: string, fx?: number, fy?: number) => void;
  onVote?: (frameId: Id<"frames">) => void;
  onWhatIf?: (frame: Doc<"frames">) => void;
  gifs?: Record<string, { src: string; mine: boolean; by: string; fx?: number; fy?: number }[]>;
  onAddGif?: (frame: Doc<"frames">) => void;
  onRemoveGif?: (frameId: Id<"frames">) => void;
  /** Members can rewrite an approved note where it stands; edits are logged. */
  onEditNote?: (note: { _id: string; text: string }) => void;
  /** Right-click on a frame: open the reaction palette at the cursor. */
  onBloom?: (frame: Doc<"frames">, clientX: number, clientY: number, fx: number, fy: number) => void;
  /** Whether the previewed app declares a dark mode; the theme flip hides otherwise. */
  supportsDarkMode?: boolean;
}

/**
 * Multiplayer cursors as an isolated subscriber: cursor writes land every
 * ~120ms while a teammate moves, and before this split every write
 * re-rendered every frame on the canvas.
 */
function CursorLayer({ me, projectId, scale }: { me: Doc<"users">; projectId: Id<"projects">; scale: number }) {
  const cursors =
    useQuery(
      api.presence.cursorsInProject,
      me ? { projectId, userId: me._id, sessionToken: sessionToken() } : "skip"
    ) ?? [];
  // Re-filter periodically so idle teammates' cursors fade even when no new
  // cursor writes arrive to re-run the query.
  const [, tick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => tick((t) => t + 1), 5_000);
    return () => clearInterval(interval);
  }, []);
  const live = cursors.filter((c) => c.userId !== me?._id && Date.now() - c.updatedAt < 10_000);
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
 * Flow edges: SVG in stage coordinates, so pan and zoom carry them with the
 * frames for free. Forward edges leave the source's right side and enter the
 * target's left; back edges (returns, cycles) sag underneath so the two
 * directions never overprint. Stroke width grows with the log of how many
 * tester sessions took the path — the trunk routes read as trunks.
 */
function FlowEdgeLayer({
  edges,
  frames,
}: {
  edges: {
    _id: string;
    fromFrameId: string;
    toFrameId: string;
    weight: number;
    label?: string;
    source?: "tests" | "manual" | "code";
  }[];
  frames: { id: string; x: number; y: number; width: number; height: number }[];
}) {
  const byId = new Map(frames.map((f) => [f.id, f]));
  return (
    <svg className="flow-edges" width="1" height="1">
      <defs>
        <marker id="flow-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 1 L 9 5 L 0 9 z" fill="var(--accent)" />
        </marker>
      </defs>
      {edges.map((edge) => {
        const from = byId.get(edge.fromFrameId);
        const to = byId.get(edge.toFrameId);
        if (!from || !to) return null;
        const forward = to.x >= from.x + from.width * 0.5;
        const x1 = forward ? from.x + from.width : from.x + from.width * 0.5;
        const y1 = forward ? from.y + from.height / 2 : from.y + from.height;
        const x2 = forward ? to.x : to.x + to.width * 0.5;
        const y2 = forward ? to.y + to.height / 2 : to.y + to.height;
        const path = forward
          ? `M ${x1} ${y1} C ${x1 + (x2 - x1) / 2} ${y1}, ${x1 + (x2 - x1) / 2} ${y2}, ${x2} ${y2}`
          : `M ${x1} ${y1} C ${x1} ${y1 + 160}, ${x2} ${y2 + 160}, ${x2} ${y2 + 6}`;
        const midX = (x1 + x2) / 2;
        const midY = forward ? (y1 + y2) / 2 : Math.max(y1, y2) + 120;
        // Weight only means something for tester-derived edges. A hand-drawn
        // edge is intent, not evidence: fixed width, dashed, and silent when
        // unlabeled — "1×" would have claimed a tester walked it. Code edges
        // (CAN-11) are the same register — the source declares this path
        // exists, nobody has been observed on it — so they share the dashed
        // treatment, quieter still, and never carry a count.
        const declared = edge.source === "manual" || edge.source === "code";
        const width = declared ? 1.5 : 1.5 + Math.log2(1 + edge.weight);
        const caption = edge.label ?? (declared ? null : `${edge.weight}×`);
        return (
          <g key={edge._id} className="flow-edge">
            <path
              d={path}
              fill="none"
              stroke="var(--accent)"
              strokeOpacity={edge.source === "code" ? 0.28 : declared ? 0.4 : 0.55}
              strokeWidth={width}
              strokeDasharray={declared ? "5 4" : undefined}
              markerEnd="url(#flow-arrow)"
            />
            {caption && (
              <text x={midX} y={midY - 8} textAnchor="middle" className="flow-edge-label">
                {caption}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

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
  branchPreviewPattern,
  reactions,
  votes,
  onReact,
  onVote,
  onWhatIf,
  gifs,
  onAddGif,
  onRemoveGif,
  onEditNote,
  onBloom,
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
  /** Exploration props: variants render from draft branches via this pattern. */
  branchPreviewPattern?: string;
  reactions?: Record<string, { emoji: string; count: number; mine: boolean; fx?: number; fy?: number }[]>;
  votes?: Record<string, { count: number; mine: boolean }>;
  onReact?: (frameId: Id<"frames">, emoji: string, fx?: number, fy?: number) => void;
  onVote?: (frameId: Id<"frames">) => void;
  onWhatIf?: (frame: Doc<"frames">) => void;
  gifs?: Record<string, { src: string; mine: boolean; by: string; fx?: number; fy?: number }[]>;
  onAddGif?: (frame: Doc<"frames">) => void;
  onRemoveGif?: (frameId: Id<"frames">) => void;
  onEditNote?: (note: { _id: string; text: string }) => void;
  onBloom?: (frame: Doc<"frames">, clientX: number, clientY: number, fx: number, fy: number) => void;
}) {
  return (
    <>
      {frames.map((frame) => {
        const pos = localPos[frame._id] ?? { x: frame.x, y: frame.y };
        const focused = focusedFrame === frame._id;
        const openCount = openCounts[frame._id] ?? 0;
        // A variant renders the same route from its draft branch. No pattern
        // means no address — the frame shows its snapshot/boot state rather
        // than silently showing main and lying about being a variant.
        const source =
          frame.kind !== "route"
            ? null
            : frame.variantBranch
              ? branchPreviewPattern
                ? { url: draftPreviewUrl(branchPreviewPattern, frame.variantBranch) + (frame.routePath ?? "/"), live: false }
                : null
              : resolveFrameUrl(frame.routePath, devStatus, previewUrl);
        const url = source?.url ?? null;
        return (
          <Fragment key={frame._id}>
          <div
            className={`frame ${focused ? "focused" : ""}`}
            style={{ left: pos.x, top: pos.y, width: frame.width, height: frame.height + 30 }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div
              className="frame-header"
              onMouseDown={(e) => {
                if (e.ctrlKey && e.button === 0 && onBloom) {
                  e.preventDefault();
                  e.stopPropagation();
                  onBloom(frame, e.clientX, e.clientY, 0.5, 0.08);
                  return;
                }
                onFrameDrag(frame, e);
              }}
            >
              <span>{frame.title}</span>
              <span className="route">{frame.routePath}</span>
              {frame.kind === "state" && (
                <span
                  className="badge state"
                  title={`A condition of ${frame.routePath ?? "this screen"}${
                    frame.stateOrigin === "crawl" ? ", found by a crawl" : ", captured by a person"
                  }`}
                >
                  state
                </span>
              )}
              {frame.variantBranch && (
                <span className="badge variant" title={`What-if: ${frame.variantPrompt ?? ""} · branch ${frame.variantBranch}`}>
                  what-if
                </span>
              )}
              {source && !source.live && !frame.variantBranch && (
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
                        ) : frame.variantBranch ? (
                          // A fresh variant has no pixels until its branch
                          // deploy finishes (minutes). Say so — an unexplained
                          // shimmer during peak attention reads as broken.
                          <div className="frame-booting variant-booting">
                            <span>The draft is deploying — pixels arrive when the build finishes.</span>
                          </div>
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
                  {frame.variantBranch
                    ? `This variant lives on ${frame.variantBranch} and needs the project's draft preview pattern (the branch icon in the toolbar) before it has an address.`
                    : frame.kind === "figma"
                    ? "Render arriving from Figma…"
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
              {(reactions?.[frame._id]?.length ?? 0) > 0 && (
                <div className="sticker-layer" aria-hidden={false}>
                  {reactions![frame._id].map((r, i) =>
                    r.fx !== undefined && r.fy !== undefined ? (
                      <button
                        key={`${r.emoji}-${i}`}
                        className={`sticker thrown ${r.mine ? "mine" : ""}`}
                        style={{ left: `${r.fx * 100}%`, top: `${r.fy * 100}%` }}
                        title={r.mine ? "Yours — click to take it back" : "Thrown by a teammate"}
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (r.mine) onReact?.(frame._id, r.emoji);
                        }}
                      >
                        {r.emoji}
                      </button>
                    ) : null
                  )}
                  <span className="sticker-cluster" onMouseDown={(e) => e.stopPropagation()}>
                    {reactions![frame._id]
                      .filter((r) => r.fx === undefined)
                      .map((r) => (
                        <button
                          key={r.emoji}
                          className={`stamp ${r.mine ? "mine" : ""}`}
                          title={r.mine ? "Click to take yours back" : "A teammate's stamp"}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (r.mine) onReact?.(frame._id, r.emoji);
                          }}
                        >
                          {r.emoji}
                          {r.count > 1 ? <i>{r.count}</i> : null}
                        </button>
                      ))}
                    {votes?.[frame._id] && votes[frame._id].count > 0 && (
                      <button
                        className={`stamp vote ${votes[frame._id].mine ? "mine" : ""}`}
                        title={votes[frame._id].mine ? "Your dot — click to take it back" : "Dot-votes"}
                        onClick={(e) => {
                          e.stopPropagation();
                          onVote?.(frame._id);
                        }}
                      >
                        ●<i>{votes[frame._id].count}</i>
                      </button>
                    )}
                  </span>
                </div>
              )}
              {(gifs?.[frame._id]?.length ?? 0) > 0 && (
                <div className="gif-stack" onMouseDown={(e) => e.stopPropagation()}>
                  {gifs![frame._id].slice(0, 8).map((g, i) => (
                    <img
                      key={i}
                      src={g.src}
                      className={`gif-sticker ${g.mine ? "mine" : ""} ${g.fx !== undefined ? "thrown" : ""}`}
                      style={g.fx !== undefined && g.fy !== undefined ? { position: "absolute", left: `${g.fx * 100}%`, top: `${g.fy * 100}%` } : undefined}
                      title={g.mine ? "Yours — click to remove" : `From ${g.by}`}
                      onClick={() => {
                        if (g.mine) onRemoveGif?.(frame._id);
                      }}
                      alt=""
                    />
                  ))}
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
                  title="Click to interact · right-click or ⌃-click to react"
                  onMouseDown={(e) => {
                    // Explicit ⌃-click path: macOS usually synthesizes a
                    // contextmenu for it, but one-button mice and some
                    // trackpad configs don't — this doesn't gamble.
                    if (e.ctrlKey && e.button === 0 && onBloom) {
                      e.preventDefault();
                      e.stopPropagation();
                      const box = e.currentTarget.getBoundingClientRect();
                      onBloom(frame, e.clientX, e.clientY, (e.clientX - box.left) / box.width, (e.clientY - box.top) / box.height);
                      return;
                    }
                    onShieldDown(frame, e);
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const box = e.currentTarget.getBoundingClientRect();
                    onBloom?.(frame, e.clientX, e.clientY, (e.clientX - box.left) / box.width, (e.clientY - box.top) / box.height);
                  }}
                />
              )}
              {commentMode && <div className="frame-shield commenting" onMouseDown={(e) => onShieldDown(frame, e)} />}
            </div>
          </div>
            {onReact && (
              /* A SIBLING of .frame, not a child, positioned in canvas
                 coordinates like the notes: .frame carries content-visibility
                 (implying paint containment), so anything a descendant paints
                 outside the frame's box is silently clipped — this bar spent
                 three bug reports invisible for exactly that reason. */
              <div
                className="rx"
                style={{ left: pos.x + 8, top: pos.y + frame.height + 38 }}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <button className="rx-trigger" title="React">
                  👍
                </button>
                <div className="rx-bar">
                  {(
                    [
                      ["👍", "Like"],
                      ["❤️", "Love"],
                      ["✨", "Polish"],
                      ["🔥", "Fire"],
                      ["😮", "Whoa"],
                      ["❓", "Question"],
                      ["😬", "Yikes"],
                    ] as const
                  ).map(([emoji, name]) => (
                    <button
                      key={emoji}
                      className="rx-emoji"
                      title={name}
                      onClick={(e) => {
                        e.stopPropagation();
                        burstEmoji(e.clientX, e.clientY, emoji);
                        playPop();
                        markFirst("reaction");
                        onReact(frame._id, emoji);
                      }}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
            )}
        </Fragment>
        );
      })}
    </>
  );
});

export default function CanvasView({
  me,
  guestToken,
  positionOverride,
  flowEdges,
  branchPreviewPattern,
  reactions,
  votes,
  onReact,
  onVote,
  onWhatIf,
  gifs,
  onAddGif,
  onRemoveGif,
  onEditNote,
  onBloom,
  supportsDarkMode,
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
  // Inline note editing: the bubble itself is the editor (no modal).
  const [editingNote, setEditingNote] = useState<{ id: string; text: string } | null>(null);
  // Perceived speed: keys are `${frameId}:${reloadToken}` so a reload shows
  // the previous pixels (snapshot underlay) until the fresh iframe paints.
  const [loadedFrames, setLoadedFrames] = useState<Record<string, boolean>>({});
  const [focusedFrame, setFocusedFrame] = useState<Id<"frames"> | null>(null);
  const [selectedThread, setSelectedThread] = useState<Id<"threads"> | null>(initialThreadId ?? null);
  const [draft, setDraft] = useState<Draft | null>(null);
  // Optimistic frame positions while dragging (and until the mutation round-trips).
  const [localPos, setLocalPos] = useState<Record<string, { x: number; y: number }>>({});

  // Tidy view: the Overview toggle now switches between your arranged
  // layout (the shared x/y in Convex) and an organized grid computed
  // client-side. Nothing moves for teammates until you drag from tidy.
  const [tidyOn, setTidyOn] = useState(() => localStorage.getItem(`commons.tidyView.${projectId}`) === "1");
  const tidyRef = useRef(tidyOn);
  tidyRef.current = tidyOn;
  const tidyPos = useMemo(() => tidyPositions(frames), [frames]);
  const tidyPosRef = useRef(tidyPos);
  tidyPosRef.current = tidyPos;
  useEffect(() => {
    localStorage.setItem(`commons.tidyView.${projectId}`, tidyOn ? "1" : "0");
  }, [tidyOn, projectId]);
  // Both directions of the switch glide: frames transition left/top while
  // the class is on, then it drops so drags stay 1:1.
  const [layoutAnim, setLayoutAnim] = useState(false);
  const layoutAnimTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pulseLayoutAnim = () => {
    setLayoutAnim(true);
    if (layoutAnimTimer.current) clearTimeout(layoutAnimTimer.current);
    layoutAnimTimer.current = setTimeout(() => setLayoutAnim(false), 440);
  };
  useEffect(() => () => {
    if (layoutAnimTimer.current) clearTimeout(layoutAnimTimer.current);
  }, []);

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
  /**
   * Dot-grid trail: a small bright-dot patch with a *static* mask, moved by
   * transform, over a dot field that counter-translates by exactly the
   * opposite amount.
   *
   * The counter-translation is the whole trick. The patch slides while the
   * field stays put in the viewport, so the bright dots land exactly on the
   * base grid underneath — and both layers move by transform alone, which the
   * compositor handles without repainting either one.
   *
   * The earlier version animated the mask's gradient center across a
   * full-viewport layer. That is a paint-time property, so every frame
   * re-rastered the whole viewport; on the web build, with frames rendering
   * alongside, that is what made it crawl.
   *
   * GLOW_HALF must stay a multiple of the 24px grid, or the patch's dots
   * drift out of phase with the base grid.
   */
  const glowRef = useRef<HTMLDivElement>(null);
  const glowFieldRef = useRef<HTMLDivElement>(null);
  const glowMeta = useRef({ x: 0, y: 0, dirX: 0, dirY: 0, mag: 0, settle: 0 as ReturnType<typeof setTimeout> | 0 });
  // Read once, not per mousemove: both were synchronous work on a hot path.
  const glowEnabled = useRef(localStorage.getItem("commons.dotGlow") !== "off");
  const wrapRect = useRef<{ left: number; top: number } | null>(null);

  // getBoundingClientRect on every mousemove forced a synchronous layout, with
  // the canvas's frames and iframes in the tree. Measure on resize instead.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const measure = () => {
      const rect = wrap.getBoundingClientRect();
      wrapRect.current = { left: rect.left, top: rect.top };
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(wrap);
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, []);

  const onCursorMove = (e: React.MouseEvent) => {
    // Dot-grid trail: two transform writes per mousemove, nothing else.
    const glow = glowRef.current;
    const field = glowFieldRef.current;
    if (glow && field && glowEnabled.current) {
      const m = glowMeta.current;
      const rect = wrapRect.current ?? { left: 0, top: 0 };
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const dx = x - m.x;
      const dy = y - m.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 0.5) {
        // Blend direction and recent movement so the trail length breathes
        // with hand speed but never jitters on tiny moves.
        m.dirX = m.dirX * 0.55 + (dx / dist) * 0.45;
        m.dirY = m.dirY * 0.55 + (dy / dist) * 0.45;
        m.mag = Math.min(22, m.mag * 0.6 + dist * 0.8);
      }
      m.x = x;
      m.y = y;
      const norm = Math.hypot(m.dirX, m.dirY) || 1;
      // Aim the patch just behind the direction of travel; the transition
      // does the trailing. The field takes the exact negative so the dots it
      // shows stay pinned to the grid rather than sliding with the patch.
      const place = (tx: number, ty: number) => {
        glow.style.transform = `translate3d(${tx}px, ${ty}px, 0)`;
        field.style.transform = `translate3d(${-tx}px, ${-ty}px, 0)`;
      };
      place(x - (m.dirX / norm) * m.mag, y - (m.dirY / norm) * m.mag);
      const overEmpty = !(e.target as HTMLElement).closest(
        ".frame, .pin, .canvas-toolbar, .minimap, .frame-notes, .frame-farlabel"
      );
      glow.classList.toggle("on", overEmpty);
      // The hand stopped: glide the light onto the cursor.
      if (m.settle) clearTimeout(m.settle);
      m.settle = setTimeout(() => {
        m.mag = 0;
        place(m.x, m.y);
      }, 130);
    }
    const send = (clientX: number, clientY: number) => {
      if (!me) return; // guests are present, but not broadcast
      lastCursorSend.current = Date.now();
      const p = screenToCanvas(clientX, clientY);
      void moveCursor({ userId: me._id, projectId, x: p.x, y: p.y, sessionToken: sessionToken() });
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

  const framePos = (frame: Doc<"frames">) =>
    positionOverride?.[frame._id] ?? (tidyOn ? tidyPos[frame._id] : localPos[frame._id]) ?? { x: frame.x, y: frame.y };

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

  const fitTo = (
    target: Doc<"frames">[],
    maxScale = 1,
    animate = true,
    at?: Record<string, { x: number; y: number }>
  ) => {
    const el = wrapRef.current;
    if (!el || target.length === 0) return;
    const p = (f: Doc<"frames">) => at?.[f._id] ?? framePos(f);
    const minX = Math.min(...target.map((f) => p(f).x));
    const minY = Math.min(...target.map((f) => p(f).y));
    const maxX = Math.max(...target.map((f) => p(f).x + f.width));
    const maxY = Math.max(...target.map((f) => p(f).y + f.height));
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
  const toggleTidy = () => {
    pulseLayoutAnim();
    if (tidyRef.current) {
      // Back to your arrangement — and, when it survived, your viewport.
      setTidyOn(false);
      const back = overviewFromRef.current;
      setOverviewFrom(null);
      if (back) animateVp(back);
    } else {
      setOverviewFrom({ ...vpRef.current });
      setTidyOn(true);
      fitTo(frames, 1, true, tidyPosRef.current);
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
  const fitRef = useRef(toggleTidy);
  fitRef.current = toggleTidy;
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
      const minY = Math.min(...frames.map((f) => framePos(f).y));
      target = frames.filter((f) => framePos(f).y <= minY + first.height * 2.2);
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
        x: el.clientWidth / 2 - (framePos(target).x + target.width / 2) * scale,
        y: el.clientHeight / 2 - (framePos(target).y + target.height / 2) * scale,
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

  const canComment = Boolean(me || guestToken);
  useEffect(() => {
    if (!canComment) return;
    return registerShortcut("c", () => setCommentMode((m) => !m), { description: "Comment mode" });
  }, [canComment]);
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
    if (!me || commentMode || e.button !== 0 || positionOverride) return;
    e.preventDefault();
    e.stopPropagation();
    if (tidyRef.current) {
      // Rearranging from the tidy view adopts it: the organized spots
      // become the shared arrangement, then this drag proceeds from there.
      const commit = tidyPosRef.current;
      setLocalPos((prev) => ({ ...prev, ...commit }));
      for (const other of frames) {
        const c = commit[other._id];
        if (me && c && (c.x !== other.x || c.y !== other.y))
          void moveFrame({ frameId: other._id, x: c.x, y: c.y, userId: me._id, sessionToken: sessionToken() });
      }
      setTidyOn(false);
      setOverviewFrom(null);
    }
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
      moveFrame({ frameId: frame._id, x: latest.x, y: latest.y, userId: me._id!, sessionToken: sessionToken() });
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

  /**
   * Guest thread creation goes through the token-gated HTTP endpoint instead
   * of the members' mutation. Same optimistic pin, same retract-on-failure;
   * the subscription on sharePage repaints the real thread when it lands.
   */
  const submitGuestDraft = async (name: string, body: string): Promise<boolean> => {
    if (!draft || !guestToken) return false;
    const coords = {
      frameId: draft.frameId,
      fx: draft.fx,
      fy: draft.fy,
      canvasX: draft.canvasX,
      canvasY: draft.canvasY,
    };
    setPendingPin(coords);
    setDraft(null);
    setCommentMode(false);
    const threadId = await postGuestThread(guestToken, { ...coords, name, body });
    if (!threadId) {
      setPendingPin(null);
      return false;
    }
    setPendingPin((p) => (p ? { ...p, threadId } : p));
    setSelectedThread(threadId as Id<"threads">);
    return true;
  };

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
      if (!me) return;
      const threadId = await createThread({ projectId, createdBy: me._id, body, mentions, sessionToken: sessionToken(), ...coords });
      markFirst("comment");
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
      onMouseLeave={() => glowRef.current?.classList.remove("on")}
    >
      <div ref={glowRef} className="dot-glow" aria-hidden>
        <div ref={glowFieldRef} className="dot-glow-field" />
      </div>
      <div
        className={`canvas-stage ${layoutAnim ? "layout-anim" : ""}`}
        style={{ transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.scale})` }}
      >
        {/* Section bands describe the tidy layout, not the frames. Under a
            derived layout (flow view) their members scatter across BFS
            columns, so the bands sprawl over the graph meaning nothing. */}
        {!positionOverride &&
          [...sectionBounds.entries()].map(([section, b]) => (
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

        {flowEdges && (
          <FlowEdgeLayer
            edges={flowEdges}
            frames={frames.map((f) => ({
              id: f._id,
              width: f.width,
              height: f.height,
              ...(positionOverride?.[f._id] ?? { x: f.x, y: f.y }),
            }))}
          />
        )}
        <FrameLayer
          frames={frames}
          localPos={positionOverride ?? (tidyOn ? tidyPos : localPos)}
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
          branchPreviewPattern={branchPreviewPattern}
          reactions={reactions}
          votes={votes}
          onReact={onReact}
          onVote={onVote}
          onWhatIf={onWhatIf}
          gifs={gifs}
          onAddGif={onAddGif}
          onRemoveGif={onRemoveGif}
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
                {notes.map((note) =>
                  editingNote?.id === note._id ? (
                    <div key={note._id} className="frame-note editing">
                      <textarea
                        autoFocus
                        value={editingNote.text}
                        onChange={(e) => setEditingNote({ id: note._id, text: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") setEditingNote(null);
                          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                            if (editingNote.text.trim() && editingNote.text.trim() !== note.text)
                              onEditNote?.({ _id: note._id, text: editingNote.text.trim() });
                            setEditingNote(null);
                          }
                        }}
                        onBlur={() => {
                          if (editingNote.text.trim() && editingNote.text.trim() !== note.text)
                            onEditNote?.({ _id: note._id, text: editingNote.text.trim() });
                          setEditingNote(null);
                        }}
                      />
                      <span className="note-hint">⌘↩ or click away saves · Esc leaves it</span>
                    </div>
                  ) : (
                    <div
                      key={note._id}
                      className="frame-note"
                      title={onEditNote ? "Click to edit — the rewrite is logged" : undefined}
                      onClick={() => onEditNote && setEditingNote({ id: note._id, text: note.text })}
                      style={onEditNote ? { cursor: "text" } : undefined}
                    >
                      {note.text}
                      {note.inferred && (
                        <span className="citation inferred" title="No evidence in the record. The designer approved this as their read">
                          inferred
                        </span>
                      )}
                    </div>
                  )
                )}
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
                  background: me?.avatarColor,
                }}
              >
                {me ? initials(me.name) : storedGuestName() ? initials(storedGuestName()) : "?"}
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

        {me && <CursorLayer me={me} projectId={projectId} scale={vp.scale} />}
      </div>

      {draft && canComment && (
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
          {me ? (
            <Composer
              users={mentionUsers ?? users}
              me={me}
              autoFocus
              placeholder="Start a thread… @ to mention"
              submitLabel="Comment"
              onSubmit={submitDraft}
              onCancel={() => setDraft(null)}
            />
          ) : (
            <GuestComposer
              autoFocus
              placeholder="Leave a comment…"
              submitLabel="Comment"
              onSubmit={submitGuestDraft}
              onCancel={() => setDraft(null)}
            />
          )}
        </div>
      )}

      {selected && (
        <div onMouseDown={(e) => e.stopPropagation()}>
          <ThreadPanel
            thread={selected}
            me={me}
            guestToken={guestToken}
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
        {/* Absent for guests rather than present-and-dead: a control that
            opens a composer nothing can submit is worse than no control. */}
        {canComment && (
          <button
            className={`btn ghost icon-btn ${commentMode ? "active" : ""}`}
            aria-label="Comment"
            title="Comment mode (C)"
            onClick={() => setCommentMode((m) => !m)}
          >
            <Icon name="message" />
          </button>
        )}
        {(annotations?.length ?? 0) > 0 && (
          <button
            className={`btn ghost icon-btn ${notesOn ? "active" : ""}`}
            aria-label="Design notes"
            title="Design notes: approved rationale under each screen"
            onClick={() => setNotesOn((on) => !on)}
          >
            <Icon name="pen" />
          </button>
        )}
        <button
          className={`btn ghost icon-btn ${tidyOn ? "active" : ""}`}
          aria-label="Tidy view"
          onClick={toggleTidy}
          title={
            tidyOn
              ? "Back to your arrangement (⌘0)"
              : "Tidy: every screen organized by section — press again to go back (⌘0)"
          }
        >
          <Icon name="maximize" />
        </button>
        {/* Only for apps that actually have a dark mode (evidence-scanned
            from the repo): a theme flip on a single-scheme app is a control
            that visibly does nothing, and dead controls read as broken. */}
        {supportsDarkMode && <PreviewAppearanceButton />}
        {/* Everything left of this changes what you're looking at; everything
            right of it changes how close you are. */}
        <span className="tb-divider" />
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
