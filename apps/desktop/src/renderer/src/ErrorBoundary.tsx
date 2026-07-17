import { Component, type ReactNode } from "react";
import { reportError } from "./lib/errorReport";

/**
 * Last line of defense against the blank-screen class of bugs: a React tree
 * crash renders a recoverable screen (and reports) instead of white nothing.
 */
export default class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    reportError("react", error.message, error.stack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="center-screen" style={{ flexDirection: "column", gap: 12, height: "100vh" }}>
        <strong>Something broke.</strong>
        <span className="hint" style={{ maxWidth: 420, textAlign: "center" }}>
          The error was reported automatically. Reloading usually fixes it — if it keeps happening, an update is
          probably already on the way.
        </span>
        <button className="btn primary" onClick={() => window.location.reload()}>
          Reload Commons
        </button>
      </div>
    );
  }
}
