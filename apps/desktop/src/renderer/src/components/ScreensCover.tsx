import type { FunctionReturnType } from "convex/server";
import type { api } from "@commons/backend/convex/_generated/api";
import { isPortraitScreen } from "@commons/shared";

type CoverScreen = FunctionReturnType<typeof api.projects.listWithActivity>[number]["coverScreens"][number];

/** The table's width over its height; .project-cover sets the same ratio. */
const TABLE = 1.9;

/** Seeded jitter in [-1, 1], so no two tables look set down by the same hand. */
function jitter(seed: string) {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (k: number) => ((((h >>> (k * 4)) & 15) / 15) * 2 - 1);
}

interface Spot {
  cx: number; // center, % of table width
  top: number; // % of table height
  rot: number; // degrees
  z: number;
  width: number; // % of table width
  height: number; // % of table height
}

/**
 * Where each screen lands. Every size comes from the frame's own width and
 * height, so a phone project fans out phones and a web app stacks browser
 * windows. The lead (the screen with the newest comment, or home) sits where
 * the eye lands: the middle of a fan, the front of a stack.
 */
function arrange(screens: CoverScreen[], j: (k: number) => number): Spot[] {
  // Size a screen by height (portrait) or width (landscape), then make sure it
  // still fits under the table's bottom edge.
  const size = (s: CoverScreen, top: number, byHeight: number | null, byWidth: number | null) => {
    const aspect = s.width / s.height;
    let height = byHeight ?? (((byWidth as number) / 100) * TABLE * 100) / aspect;
    height = Math.min(height, 97 - top);
    return { height, width: ((height / 100) * aspect * 100) / TABLE };
  };
  if (isPortraitScreen(screens[0])) {
    const slots =
      screens.length === 1
        ? [{ cx: 50, top: 8, rot: 0 }]
        : screens.length === 2
          ? [
              { cx: 41, top: 8, rot: -3 },
              { cx: 61, top: 12, rot: 5 },
            ]
          : [
              { cx: 50, top: 6, rot: 0 },
              { cx: 31, top: 12, rot: -6 },
              { cx: 69, top: 12, rot: 6 },
            ];
    return screens.map((s, i) => {
      const slot = slots[i];
      const portrait = isPortraitScreen(s);
      const top = portrait ? slot.top : 30;
      return {
        cx: slot.cx + j(i) * 1.5,
        top,
        rot: slot.rot + j(i + 3) * 1.5,
        z: i === 0 ? 3 : 1,
        ...size(s, top, portrait ? 84 : 42, null),
      };
    });
  }
  if (screens.length === 1) {
    return [{ cx: 50, top: 12, rot: j(1) * 1.5, z: 3, ...size(screens[0], 12, null, 72) }];
  }
  const back = screens[1];
  const backPortrait = isPortraitScreen(back);
  return [
    { cx: 40 + j(1) * 2, top: 26, rot: -2 + j(2), z: 3, ...size(screens[0], 26, null, 60) },
    backPortrait
      ? { cx: 77 + j(3), top: 8, rot: 5 + j(4), z: 1, ...size(back, 8, 84, null) }
      : { cx: 62 + j(3) * 2, top: 8, rot: 2.5 + j(4), z: 1, ...size(back, 8, null, 56) },
  ];
}

/** A project's own screens laid on a little canvas: the home card's cover. */
export default function ScreensCover({ screens, seed }: { screens: CoverScreen[]; seed: string }) {
  const spots = arrange(screens, jitter(seed));
  return (
    <div className="screens-cover">
      {screens.map((s, i) => {
        const spot = spots[i];
        return (
          <div
            key={s.frameId}
            className="cover-screen"
            style={{
              left: `${spot.cx}%`,
              top: `${spot.top}%`,
              width: `${spot.width}%`,
              height: `${spot.height}%`,
              zIndex: spot.z,
              transform: `translateX(-50%) rotate(${spot.rot.toFixed(2)}deg)`,
              borderRadius: isPortraitScreen(s) ? "9px" : "5px",
            }}
          >
            {s.url ? (
              <img src={s.url} alt="" loading="lazy" decoding="async" draggable={false} />
            ) : (
              <span className="cover-blank" />
            )}
            {s.pin && <span className="cover-pin" style={{ left: `${s.pin.fx * 100}%`, top: `${s.pin.fy * 100}%` }} />}
          </div>
        );
      })}
    </div>
  );
}
