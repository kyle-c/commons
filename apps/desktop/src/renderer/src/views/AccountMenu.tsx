import { useRef, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@commons/backend/convex/_generated/api";
import type { Doc } from "@commons/backend/convex/_generated/dataModel";
import { initials } from "../lib/session";
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
