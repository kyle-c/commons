/**
 * Ribbon Routes: the default project cover. Flowing brand-palette ribbons
 * with a dashed route line and nodes, generated deterministically from the
 * project id — every project gets its own composition, stable forever, no
 * stored image. Uploaded covers still win.
 */

/** mulberry32 over a string hash: cheap deterministic PRNG. */
function rng(seed: string): () => number {
  let h = 1779033703;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 3432918353);
  let a = h >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Unified Craft ribbon palettes: moss, teal, bronze, sage combinations that
// hold on both the sand and charcoal card surfaces.
const PALETTES: string[][] = [
  ["#5c6650", "#8a9478", "#3e6b5e"],
  ["#2e6b62", "#3e9c8f", "#7fae9e"],
  ["#3e9c8f", "#b0722f", "#2e5d55"],
  ["#6b7357", "#9aa284", "#46503c"],
  ["#35706b", "#5c6650", "#c2a377"],
  ["#4d7a70", "#8a9478", "#b0722f"],
];

const W = 400;
const H = 220;

export default function RibbonCover({ seed }: { seed: string }) {
  const rand = rng(seed);
  const palette = PALETTES[Math.floor(rand() * PALETTES.length)];
  const ribbonCount = 2 + Math.floor(rand() * 2); // 2-3 ribbons

  const ribbons: { d: string; fill: string; opacity: number }[] = [];
  const centers: { y0: number; c0: number; c1: number; y1: number }[] = [];
  for (let i = 0; i < ribbonCount; i++) {
    const t = 28 + rand() * 46; // thickness
    const y0 = 30 + rand() * (H - 60);
    const y1 = 30 + rand() * (H - 60);
    const c0 = y0 + (rand() - 0.5) * 180;
    const c1 = y1 + (rand() - 0.5) * 180;
    centers.push({ y0: y0 + t / 2, c0: c0 + t / 2, c1: c1 + t / 2, y1: y1 + t / 2 });
    ribbons.push({
      d:
        `M 0 ${y0} C ${W / 3} ${c0}, ${(2 * W) / 3} ${c1}, ${W} ${y1} ` +
        `L ${W} ${y1 + t} C ${(2 * W) / 3} ${c1 + t * 0.9}, ${W / 3} ${c0 + t * 1.1}, 0 ${y0 + t} Z`,
      fill: palette[i % palette.length],
      // Band opacity lives in CSS (.ribbon-cover .band) so each theme can
      // tune how far the glaze sits back; the lead band reads strongest.
      opacity: i === 0 ? 1 : 0.8,
    });
  }

  // The dashed route rides one ribbon's centerline, nodes along the way.
  const route = centers[Math.floor(rand() * centers.length)];
  const routeD = `M 0 ${route.y0} C ${W / 3} ${route.c0}, ${(2 * W) / 3} ${route.c1}, ${W} ${route.y1}`;
  const bezier = (p: number) => {
    const u = 1 - p;
    return (
      u * u * u * route.y0 + 3 * u * u * p * route.c0 + 3 * u * p * p * route.c1 + p * p * p * route.y1
    );
  };
  const nodes = [0.22 + rand() * 0.12, 0.5 + rand() * 0.14, 0.78 + rand() * 0.12].map((p) => ({
    x: p * W,
    y: bezier(p),
    open: rand() > 0.5,
  }));

  return (
    <svg
      className="ribbon-cover"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid slice"
      aria-hidden
    >
      <rect width={W} height={H} fill="var(--bg-input)" />
      {ribbons.map((ribbon, i) => (
        <g
          key={i}
          className="band"
          // Each band drifts on its own clock, so the layers separate instead
          // of sliding as one sheet. Negative delay starts them mid-phase, so
          // a freshly rendered card is already in motion rather than visibly
          // beginning to move as you look at it.
          style={{ animationDuration: `${23 + i * 8}s`, animationDelay: `${i * -6}s` }}
        >
          <path d={ribbon.d} fill={ribbon.fill} opacity={ribbon.opacity} />
        </g>
      ))}
      <path
        d={routeD}
        fill="none"
        stroke="rgba(250, 248, 240, 0.55)"
        strokeWidth="1.5"
        strokeDasharray="5 6"
      />
      {nodes.map((node, i) =>
        node.open ? (
          <circle key={i} cx={node.x} cy={node.y} r="5" fill="none" stroke="rgba(250,248,240,0.7)" strokeWidth="1.5" />
        ) : (
          <circle key={i} cx={node.x} cy={node.y} r="3.5" fill="rgba(250,248,240,0.7)" />
        )
      )}
    </svg>
  );
}
