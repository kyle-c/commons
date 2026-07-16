import { useState } from "react";
import { setConvexUrl } from "../lib/session";

/** Shown once per machine until a Convex deployment URL is configured. */
export default function SetupScreen() {
  const [url, setUrl] = useState("");
  const valid = /^https?:\/\/.+/.test(url.trim());

  return (
    <div className="center-screen">
      <div className="center-card">
        <h1>Connect Commons to its backend</h1>
        <p>
          Run <code>pnpm -C packages/backend dev</code> in the Commons repo, then paste the deployment URL it prints
          (looks like <code>https://…convex.cloud</code> or a local <code>http://127.0.0.1</code> URL).
        </p>
        <label>Convex deployment URL</label>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://your-deployment.convex.cloud"
          autoFocus
        />
        <button
          className="btn primary"
          disabled={!valid}
          onClick={() => {
            setConvexUrl(url);
            location.reload();
          }}
        >
          Connect
        </button>
      </div>
    </div>
  );
}
