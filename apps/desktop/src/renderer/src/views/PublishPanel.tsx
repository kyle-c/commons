import { useEffect, useState } from "react";

/**
 * The one git write Commons offers, named for what it achieves.
 *
 * Nobody opens Commons wanting to push. They want the link they just shared to
 * show the thing they just changed, and a push is merely how that happens — so
 * the button says what you get, and the sentence underneath says what it will
 * do to your repo.
 *
 * Committing everything is how people accidentally commit an .env, so the file
 * list is not a detail view: it is the entire safeguard, and it is shown before
 * the message field rather than folded behind a disclosure. Anything that looks
 * like a credential is called out, because a list of forty files is something
 * people scroll past.
 *
 * What this deliberately cannot do: merge, rebase, switch branches, or resolve
 * a conflict. Those need judgement, engineers have better tools for them, and
 * non-engineers have no working copy to apply them to.
 */

type PendingFile = { path: string; state: string; risky: boolean };

export function PublishPanel({
  repoPath,
  branch,
  ahead,
  onClose,
  onPublished,
}: {
  repoPath: string;
  branch: string;
  /** Commits already committed locally and not yet on origin. */
  ahead: number;
  onClose: () => void;
  onPublished: () => void;
}) {
  const [files, setFiles] = useState<PendingFile[] | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void window.commons.pendingChanges(repoPath).then((result) => setFiles(result.files));
  }, [repoPath]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  const dirty = (files?.length ?? 0) > 0;
  const risky = files?.filter((f) => f.risky) ?? [];
  const ready = files !== null && (!dirty || message.trim() !== "");

  const publish = async () => {
    setBusy(true);
    setError(null);
    const result = await window.commons.publishRepo(repoPath, dirty ? message.trim() : undefined);
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onPublished();
    onClose();
  };

  return (
    <div className="overlay-scrim" onMouseDown={() => !busy && onClose()}>
      <div className="overlay-card" onMouseDown={(e) => e.stopPropagation()}>
        <header>
          <span>Update preview</span>
          <button className="btn ghost" onClick={onClose} disabled={busy} aria-label="Close">
            ✕
          </button>
        </header>

        <div className="publish-body">
          {/* Plain account of what is about to happen to the repo, before the
              controls that do it. */}
          <p className="publish-summary">
            {dirty
              ? `Commits ${files!.length} changed file${files!.length === 1 ? "" : "s"} and pushes ${branch} to origin.`
              : ahead > 0
                ? `Pushes ${ahead} commit${ahead === 1 ? "" : "s"} from ${branch} to origin.`
                : "Everything here is already on origin."}
            {(dirty || ahead > 0) && " Your host builds from origin, so the preview updates when that deploy goes green."}
          </p>

          {risky.length > 0 && (
            <p className="publish-warning">
              {risky.length === 1 ? `${risky[0].path} looks like` : `${risky.length} of these look like`} a secret. Commons
              commits all or nothing, so check before you publish.
            </p>
          )}

          {dirty && (
            <>
              <ul className="publish-files">
                {files!.map((file) => (
                  <li key={file.path} className={file.risky ? "risky" : undefined}>
                    <span className="state">{file.state}</span>
                    <span className="path">{file.path}</span>
                  </li>
                ))}
              </ul>
              <input
                autoFocus
                className="publish-message"
                placeholder="What changed? e.g. “New nav bar on mobile”"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && ready && !busy) void publish();
                }}
              />
            </>
          )}

          {error && <p className="publish-error">{error}</p>}
        </div>

        <div className="connection-actions">
          <button className="btn ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn" onClick={() => void publish()} disabled={!ready || busy || (!dirty && ahead === 0)}>
            {busy ? "Publishing…" : dirty ? "Commit and update preview" : "Update preview"}
          </button>
        </div>
      </div>
    </div>
  );
}
