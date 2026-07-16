import { useState } from "react";

const SEEN_KEY = "commons.welcomeSeen";

/** One-time orientation card shown after the first sign-in on this machine. */
export default function Welcome({ name }: { name: string }) {
  const [seen, setSeen] = useState(() => localStorage.getItem(SEEN_KEY) === "1");
  if (seen) return null;

  return (
    <div className="overlay-scrim">
      <div className="overlay-card welcome">
        <header>
          <span>Welcome to Commons, {name.split(" ")[0]} 👋</span>
        </header>
        <div className="welcome-body">
          <p>One shared canvas where the team designs on the live product.</p>
          <ul>
            <li>
              <strong>Look around</strong> — open a project, pan with two fingers, pinch or ⌘-scroll to zoom.
              Click a frame to use the real app inside it; Esc to release.
            </li>
            <li>
              <strong>Say something</strong> — press <kbd>C</kbd> and click anywhere on a screen to start a
              thread. <kbd>@</kbd> mentions a teammate; they get it in their inbox and email.
            </li>
            <li>
              <strong>Feel the flow</strong> — the Prototype tab is the running app, full-size, at phone or
              desktop widths.
            </li>
          </ul>
          <p className="hint">
            Press <kbd>?</kbd> anytime for keyboard shortcuts.
          </p>
        </div>
        <div className="welcome-actions">
          <button
            className="btn primary"
            onClick={() => {
              localStorage.setItem(SEEN_KEY, "1");
              setSeen(true);
            }}
          >
            Explore projects
          </button>
        </div>
      </div>
    </div>
  );
}
