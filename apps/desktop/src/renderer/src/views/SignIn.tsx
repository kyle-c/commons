import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@commons/backend/convex/_generated/api";
import { setStoredSession, type StoredSession } from "../lib/session";

const FAIL_MESSAGES: Record<string, string> = {
  not_invited: "That Google account isn't on the team yet. Ask a teammate to invite you (Team menu), then try again.",
  expired: "The sign-in took too long — try again.",
  unverified_email: "That Google account has no verified email address.",
};

// Google sign-in through the system browser. `auth.start` returns the Google
// URL plus a `state`; the app then learns the outcome two ways, whichever
// lands first: the commons://auth/callback deep link, or the live `auth.status`
// subscription (which also covers dev builds where commons:// isn't registered).
export default function SignIn({ onSignedIn }: { onSignedIn: (session: StoredSession) => void }) {
  const start = useMutation(api.auth.start);
  const claim = useMutation(api.auth.claim);
  const [state, setState] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const status = useQuery(api.auth.status, state ? { state } : "skip");
  const stateRef = useRef<string | null>(null);
  const claiming = useRef(false);
  stateRef.current = state;

  const finish = useCallback(
    async (forState: string) => {
      if (claiming.current) return;
      claiming.current = true;
      const session = await claim({ state: forState });
      if (session) {
        const stored = { userId: session.userId, token: session.token };
        setStoredSession(stored);
        onSignedIn(stored);
      } else {
        claiming.current = false;
        setState(null);
        setError("Sign-in could not be completed — try again.");
      }
    },
    [claim, onSignedIn]
  );

  useEffect(() => {
    // Absent in the plain-browser web fallback; the status query covers it.
    if (!window.commons) return;
    return window.commons.onAuthCallback((auth) => {
      if (auth.state === stateRef.current) void finish(auth.state);
    });
  }, [finish]);

  useEffect(() => {
    if (!state || !status) return;
    if (status.status === "authorized") {
      void finish(state);
    } else if (status.status === "failed") {
      setState(null);
      setError(FAIL_MESSAGES[status.error ?? ""] ?? "Sign-in failed — try again.");
    }
  }, [state, status, finish]);

  const begin = async () => {
    setError(null);
    try {
      const { state: newState, url } = await start({});
      setState(newState);
      if (window.commons) await window.commons.openExternal(url);
      else window.open(url, "_blank");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start sign-in.");
    }
  };

  return (
    <div className="center-screen">
      <div className="center-card">
        <h1>Commons</h1>
        <p>One canvas for designing in Figma and in code. Sign in with your team Google account.</p>
        {state === null ? (
          <button className="btn primary" onClick={begin}>
            Continue with Google
          </button>
        ) : (
          <>
            <p>Finishing sign-in in your browser — come back here when Google is done.</p>
            <button className="btn ghost" onClick={() => setState(null)}>
              Cancel
            </button>
          </>
        )}
        {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
        <p className="hint">Commons is invite-only — ask a teammate to invite your email if it's your first time.</p>
      </div>
    </div>
  );
}
