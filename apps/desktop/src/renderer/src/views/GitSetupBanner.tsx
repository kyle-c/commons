import { useEffect, useState } from "react";
import type { Doc } from "@commons/backend/convex/_generated/dataModel";
import type { GitSetupStatus } from "@commons/shared";

const DISMISS_KEY = "commons.gitSetupDismissed";

/**
 * Onboarding preflight for the git integration: probes the three things that
 * make clone / draft / ship fail for new users, and shows a row per failing
 * check with the smallest possible fix. Fully hidden when everything passes.
 */
export default function GitSetupBanner({ me, probeRemote }: { me: Doc<"users">; probeRemote?: string }) {
  const [setup, setSetup] = useState<GitSetupStatus | null>(null);
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISS_KEY) === "1");
  const [busy, setBusy] = useState(false);

  const refresh = () => {
    if (!window.commons) return;
    window.commons
      .checkGitSetup(probeRemote)
      .then(setSetup)
      .catch(() => {});
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(refresh, [probeRemote]);

  if (!setup || dismissed) return null;
  const identityMissing = setup.gitInstalled && (!setup.identityName || !setup.identityEmail);
  const authMissing = setup.remoteAccess === "auth_failed";
  if (setup.gitInstalled && !identityMissing && !authMissing) return null;

  const fixIdentity = async () => {
    setBusy(true);
    try {
      const result = await window.commons.setGitIdentity(me.name, me.email);
      if (!result.ok) alert(result.message);
      refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="nudge-banner card" style={{ marginBottom: 20 }}>
      <div className="setup-rows">
        <strong>Finish setting up — so cloning and shipping drafts just work:</strong>
        {!setup.gitInstalled && (
          <div className="setup-row">
            ⚠️ Git isn't installed. Run <code>xcode-select --install</code> in Terminal, then re-check.
          </div>
        )}
        {identityMissing && (
          <div className="setup-row">
            ⚠️ Your commits need a name.
            <button className="btn" disabled={busy} onClick={fixIdentity}>
              Use {me.name} · {me.email}
            </button>
          </div>
        )}
        {authMissing && (
          <div className="setup-row">
            ⚠️ GitHub needs credentials (for “Get this project” and shipping drafts). Easiest: install the GitHub
            CLI and run <code>gh auth login</code> in Terminal, then re-check.
          </div>
        )}
        <div className="setup-row hint">
          <button className="btn ghost" onClick={refresh}>
            Re-check
          </button>
        </div>
      </div>
      <button
        className="btn ghost"
        title="Dismiss on this machine"
        onClick={() => {
          localStorage.setItem(DISMISS_KEY, "1");
          setDismissed(true);
        }}
      >
        ✕
      </button>
    </div>
  );
}
