import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@commons/backend/convex/_generated/api";
import type { Doc } from "@commons/backend/convex/_generated/dataModel";
import { sessionToken } from "../lib/session";

const SEEN_KEY = "commons.welcomeSeen";

/**
 * First run asks exactly one question — what brings you here — because the
 * fastest path to value is different for the three people Commons serves.
 * The answer tunes the getting-started card on home (and stores on the
 * user, so later surfaces can default sensibly). No tour, no steps: each
 * door is one sentence of promise, and the real teaching happens where the
 * features live.
 */
export default function Welcome({ me }: { me: Doc<"users"> }) {
  const [seen, setSeen] = useState(() => localStorage.getItem(SEEN_KEY) === "1");
  const setOrientation = useMutation(api.users.setOrientation);
  if (seen || me.orientation) return null;

  const close = () => {
    localStorage.setItem(SEEN_KEY, "1");
    setSeen(true);
  };
  const choose = (orientation: "designer" | "pm" | "engineer") => {
    void setOrientation({ orientation, userId: me._id, sessionToken: sessionToken() }).catch(() => {});
    close();
  };

  return (
    <div className="overlay-scrim">
      <div className="overlay-card welcome">
        <header>
          <span>Welcome, {me.name.split(" ")[0]} 👋</span>
        </header>
        <div className="welcome-body">
          <p className="welcome-lead">
            Everything on the canvas is the real product, running live. What brings you here?
          </p>
          <div className="welcome-doors">
            <button className="welcome-door" onClick={() => choose("designer")}>
              <strong>I design it</strong>
              <span>Mark up live screens, and ask an agent for working variants.</span>
            </button>
            <button className="welcome-door" onClick={() => choose("pm")}>
              <strong>I steer it</strong>
              <span>Review the real thing, react in one click, prove it with user tests.</span>
            </button>
            <button className="welcome-door" onClick={() => choose("engineer")}>
              <strong>I build it</strong>
              <span>Point Commons at a repo and every screen lands live on a shared canvas.</span>
            </button>
          </div>
          <p className="hint">
            <kbd>?</kbd> shows every shortcut, whoever you are.
          </p>
        </div>
        <div className="welcome-actions">
          <button className="btn ghost" onClick={close}>
            Just looking
          </button>
        </div>
      </div>
    </div>
  );
}
