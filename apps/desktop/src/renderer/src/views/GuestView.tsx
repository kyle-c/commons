import { useQuery } from "convex/react";
import { api } from "@commons/backend/convex/_generated/api";
import type { Id } from "@commons/backend/convex/_generated/dataModel";
import CanvasView from "../canvas/CanvasView";

/**
 * Guest mode: the real canvas, scoped by a share token (Phase 3).
 *
 * The share page used to be a second implementation of the canvas — 500 lines
 * of server-rendered HTML that drifted from the app with every change, and
 * where every improvement had to be built twice or not at all. This is the
 * same CanvasView the signed-in app mounts, handed a null viewer.
 *
 * What a guest gets is therefore whatever the canvas can do without a session:
 * pan, zoom, tidy view, snapshots, live preview frames when the project has a
 * deployed URL, the Notes layer, and threads they can read. What they don't
 * get is anything that writes — no cursors, no dragging, no replies. Those are
 * absent rather than disabled-looking, except in a thread, where the missing
 * reply box is explained.
 *
 * The token is the credential, exactly as on /p/. Revoking it in Sharing cuts
 * this off, and sharePage only ever returns approved annotations.
 */
export default function GuestView({ shareToken }: { shareToken: string }) {
  const data = useQuery(api.projects.sharePage, { shareToken });

  if (data === undefined) {
    return (
      <div className="guest-shell">
        <p className="guest-message">Loading…</p>
      </div>
    );
  }

  if (data === null) {
    return (
      <div className="guest-shell">
        <div className="guest-message">
          <h1>This link no longer works</h1>
          <p>It was revoked, or the project it pointed to was archived. Ask whoever shared it for a new link.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="guest-shell">
      <header className="guest-bar">
        <span className="guest-project">{data.project.name}</span>
        <span className="guest-note">Shared link. Look around, read the discussion, leave comments.</span>
      </header>
      <div className="guest-canvas">
        <CanvasView
          me={null}
          guestToken={shareToken}
          projectId={data.project._id as Id<"projects">}
          frames={data.frames}
          threads={data.threads}
          users={[]}
          devStatus={{ state: "stopped" }}
          previewUrl={data.project.previewUrl}
          annotations={data.annotations.map((a) => ({
            _id: a._id,
            frameId: a.frameId,
            text: a.text,
            // No citations means the model guessed it, and the Notes layer
            // says so. Same rule the signed-in canvas applies.
            inferred: a.citations.length === 0,
          }))}
        />
      </div>
    </div>
  );
}
