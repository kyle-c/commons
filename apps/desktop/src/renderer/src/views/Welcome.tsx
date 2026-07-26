import { useState } from "react";

const SEEN_KEY = "commons.welcomeSeen";

/**
 * One-time orientation card after the first sign-in on this machine. Three
 * beats, each one thought: wander, react, go deeper. Copy stays universal
 * across desktop and the browser app (everything mentioned works in both).
 */
export default function Welcome({ name }: { name: string }) {
  const [seen, setSeen] = useState(() => localStorage.getItem(SEEN_KEY) === "1");
  if (seen) return null;

  return (
    <div className="overlay-scrim">
      <div className="overlay-card welcome">
        <header>
          <span>Welcome, {name.split(" ")[0]} 👋</span>
        </header>
        <div className="welcome-body">
          <p className="welcome-lead">Everything here is the real product, running live.</p>
          <ul>
            <li>
              <strong>Wander.</strong> Pan like a map. Click a screen to try it, <kbd>Esc</kbd> steps out.
            </li>
            <li>
              <strong>React.</strong> Press <kbd>C</kbd>, click anywhere, say the thing.
            </li>
            <li>
              <strong>Go deeper.</strong> The Prototype tab runs the app full-size.
            </li>
          </ul>
          <p className="hint">
            <kbd>?</kbd> shows every shortcut.
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
            Look around
          </button>
        </div>
      </div>
    </div>
  );
}
