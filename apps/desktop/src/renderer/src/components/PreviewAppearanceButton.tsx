import { useState } from "react";
import Icon from "./icons";
import {
  getPreviewAppearance,
  setPreviewAppearance,
  type PreviewAppearance,
} from "../lib/previewAppearance";

const ORDER: PreviewAppearance[] = ["light", "dark", "system"];
const ICONS = { light: "sun", dark: "moon", system: "monitor" } as const;
const LABELS = { light: "light", dark: "dark", system: "this Mac's" };

/**
 * Cycles the appearance embedded screens render with: light → dark → system.
 * Distinct from the titlebar theme toggle, which styles Commons itself.
 * Hidden in the browser app, where the OS scheme applies.
 */
export default function PreviewAppearanceButton() {
  const [mode, setMode] = useState<PreviewAppearance>(getPreviewAppearance());
  if (!window.commons) return null;
  const next = ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length];
  return (
    <button
      className="btn ghost icon-btn"
      aria-label="Preview appearance"
      title={`Screens render in ${LABELS[mode]} mode. Click to switch to ${LABELS[next]}.`}
      onClick={() => {
        setPreviewAppearance(next);
        setMode(next);
      }}
    >
      <Icon name={ICONS[mode]} size={14} />
    </button>
  );
}
