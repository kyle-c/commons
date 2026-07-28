import { useState } from "react";
import Icon from "./icons";
import {
  getPreviewAppearance,
  setPreviewAppearance,
  type PreviewAppearance,
} from "../lib/previewAppearance";

/**
 * Flips the appearance embedded screens render with: light <-> dark.
 * Binary on purpose — the old third "system" stop read as a mystery
 * monitor icon. A stored "system" preference resolves to what it
 * currently means and flips from there. Distinct from the account
 * menu's theme toggle, which styles Commons itself.
 */
export default function PreviewAppearanceButton() {
  const [mode, setMode] = useState<PreviewAppearance>(getPreviewAppearance());
  const resolved =
    mode === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : mode;
  const next = resolved === "light" ? "dark" : "light";
  return (
    <button
      className="btn ghost icon-btn"
      aria-label="Preview appearance"
      title={`Screens render in ${resolved} mode. Click to switch to ${next}.`}
      onClick={() => {
        setPreviewAppearance(next);
        setMode(next);
      }}
    >
      <Icon name={resolved === "light" ? "sun" : "moon"} size={14} />
    </button>
  );
}
