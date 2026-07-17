import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@commons/backend/convex/_generated/api";
import type { Doc } from "@commons/backend/convex/_generated/dataModel";
import { initials, sessionToken } from "../lib/session";
import { useClickOutside } from "../lib/useClickOutside";

/**
 * Titlebar avatar menu: change photo (uploaded to Convex storage), reset to
 * the Google profile photo (the default), sign out.
 */
export default function AccountMenu({ me, onSignOut }: { me: Doc<"users">; onSignOut: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  useClickOutside(wrapRef, () => setOpen(false), open);

  const generateUploadUrl = useMutation(api.users.generateAvatarUploadUrl);
  const setAvatarImage = useMutation(api.users.setAvatarImage);
  const resetAvatar = useMutation(api.users.resetAvatar);

  // Linked emails: one account, many addresses. Linking reuses the Google
  // OAuth flow — signing in with the other address once IS the verification.
  const linked = useQuery(api.auth.linkedEmails, open ? { userId: me._id, sessionToken: sessionToken() } : "skip");
  const startAuth = useMutation(api.auth.start);
  const unlinkEmail = useMutation(api.auth.unlinkEmail);
  const [linkState, setLinkState] = useState<string | null>(null);
  const linkStatus = useQuery(api.auth.status, linkState ? { state: linkState } : "skip");
  useEffect(() => {
    if (!linkStatus) return;
    if (linkStatus.status === "authorized" || linkStatus.status === "failed") {
      // Leave the row visible a beat so the outcome is readable, then reset.
      const timer = setTimeout(() => setLinkState(null), 4000);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [linkStatus]);

  const linkAnother = async () => {
    const { state, url } = await startAuth({ linkSessionToken: sessionToken() });
    setLinkState(state);
    if (window.commons) await window.commons.openExternal(url);
    else window.open(url);
  };

  const uploadPhoto = async (file: File) => {
    setBusy(true);
    try {
      const uploadUrl = await generateUploadUrl();
      const res = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!res.ok) throw new Error(`Upload failed (${res.status})`);
      const { storageId } = await res.json();
      await setAvatarImage({ userId: me._id, storageId });
      setOpen(false);
    } catch (err) {
      console.error("avatar upload failed", err);
      alert("Couldn't upload that image — try a different file.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ position: "relative" }} ref={wrapRef}>
      <button
        className="avatar"
        style={{ background: me.avatarColor, width: 26, height: 26 }}
        title={me.name}
        onClick={() => setOpen(!open)}
      >
        {me.avatarUrl ? <img src={me.avatarUrl} alt="" /> : initials(me.name)}
      </button>
      {open && (
        <div className="titlebar-popover popover-menu">
          <div className="team-row">
            <span className="avatar" style={{ background: me.avatarColor }}>
              {me.avatarUrl ? <img src={me.avatarUrl} alt="" /> : initials(me.name)}
            </span>
            <span className="who">
              <span className="name">{me.name}</span>
              <span className="email">{me.email}</span>
            </span>
          </div>
          {(linked ?? []).map((row) => (
            <div key={row.id} className="linked-email-row">
              <span className="email">{row.email}</span>
              <button
                className="btn ghost"
                title="Unlink (workspace memberships it earned are kept)"
                onClick={() => void unlinkEmail({ emailId: row.id, userId: me._id, sessionToken: sessionToken() })}
              >
                ✕
              </button>
            </div>
          ))}
          {linkState ? (
            <div className="hint" style={{ padding: "4px 14px 8px" }}>
              {!linkStatus || linkStatus.status === "pending"
                ? "Finish signing in with the other Google account in your browser…"
                : linkStatus.status === "authorized"
                  ? "✓ Linked — that address now signs into this account."
                  : linkStatus.error === "email_in_use"
                    ? "That email already belongs to another Commons account."
                    : "Linking didn't complete — try again."}
            </div>
          ) : (
            <button title="Add a work or personal address to this account — sign-ins with it land here, and its company domain joins you to that team's workspace" onClick={linkAnother}>
              Link another email…
            </button>
          )}
          <button disabled={busy} onClick={() => fileRef.current?.click()}>
            {busy ? "Uploading…" : "Change photo…"}
          </button>
          {me.avatarStorageId && (
            <button disabled={busy} onClick={() => void resetAvatar({ userId: me._id })}>
              Reset to Google photo
            </button>
          )}
          <button onClick={onSignOut}>Sign out</button>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void uploadPhoto(file);
            }}
          />
        </div>
      )}
    </div>
  );
}
