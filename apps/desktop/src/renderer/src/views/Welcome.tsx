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
          <span>Welcome to Commons, {name.split(" ")[0]} 👋</span>
        </header>
        <div className="welcome-body">
          <p className="welcome-lead">
            Everything on this canvas is the real, running product. Not screenshots. Not mockups.
          </p>
          <ul>
            <li>
              <strong>Wander.</strong> Pan and pinch like a map. Click any screen to use the live app inside
              it, <kbd>Esc</kbd> to step back out.
            </li>
            <li>
              <strong>React.</strong> Press <kbd>C</kbd>, click a pixel, say the thing. <kbd>@</kbd> pulls a
              teammate in.
            </li>
            <li>
              <strong>Go deeper.</strong> The Prototype tab runs the app full-size, and the notes under each
              screen explain why it's built that way.
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
