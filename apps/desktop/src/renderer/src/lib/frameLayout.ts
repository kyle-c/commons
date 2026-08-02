import type { DiscoveredRoute, RepoInspection } from "@commons/shared";

/**
 * Tidy view: an organized layout computed from existing frames — same
 * section-band grid as discovery-time layout, but client-side and ephemeral.
 * The arranged (dragged) positions in Convex stay untouched; this is just
 * how the canvas *displays* while the Tidy toggle is on.
 */
/**
 * One set of spacing constants for every layout path (discovery and Tidy),
 * extracted after they drifted apart in spirit: frames grew ornaments —
 * headers, stamps, tallies, stickers — and the gaps tuned for bare
 * rectangles read as cramped. Air is what makes a wall of screens a wall
 * of *separate* screens.
 */
export function frameGrid(mobile: boolean, height: number) {
  return {
    gapX: mobile ? 140 : 200,
    gapY: mobile ? 200 : 240,
    cols: mobile ? 6 : 3,
    sectionGap: Math.round(height * 0.6),
  };
}

export function tidyPositions(
  frames: {
    _id: string;
    routePath?: string;
    section?: string;
    width: number;
    height: number;
  }[]
): Record<string, { x: number; y: number }> {
  const bySection = new Map<string, typeof frames>();
  for (const frame of frames) {
    const key = frame.section ?? "";
    if (!bySection.has(key)) bySection.set(key, []);
    bySection.get(key)!.push(frame);
  }
  const sections = [...bySection.entries()].sort((a, b) => (a[0] === "" ? 1 : b[0] === "" ? -1 : 0));

  const out: Record<string, { x: number; y: number }> = {};
  let yOffset = 0;
  for (const [, sectionFrames] of sections) {
    // Route order, "/" first — stable and predictable, not creation order.
    sectionFrames.sort((a, b) => (a.routePath ?? "").localeCompare(b.routePath ?? ""));
    const width = Math.max(...sectionFrames.map((f) => f.width));
    const height = Math.max(...sectionFrames.map((f) => f.height));
    const mobile = width < 500;
    const { gapX, gapY, cols } = frameGrid(mobile, height);
    sectionFrames.forEach((frame, i) => {
      out[frame._id] = {
        x: (i % cols) * (width + gapX),
        y: yOffset + Math.floor(i / cols) * (height + gapY),
      };
    });
    const rows = Math.ceil(sectionFrames.length / cols);
    yOffset += rows * (height + gapY) + frameGrid(mobile, height).sectionGap;
  }
  return out;
}

export interface FrameSpec {
  kind: "route";
  title: string;
  routePath: string;
  section?: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Grid-lay the discovered (static) routes as canvas frames, clustered into
 * one labeled band per section (route groups / shared first segments).
 * Mobile frameworks get phone-sized frames; web frameworks desktop-sized.
 */
export function layoutFrames(inspection: RepoInspection): FrameSpec[] {
  const mobile = inspection.framework === "expo";
  const width = inspection.device?.width ?? (mobile ? 390 : 1280);
  const height = inspection.device?.height ?? (mobile ? 844 : 800);
  const { gapX, gapY, cols, sectionGap } = frameGrid(mobile, height);

  const routes = inspection.routes.filter((route) => !route.dynamic);
  const bySection = new Map<string, DiscoveredRoute[]>();
  for (const route of routes) {
    const key = route.section ?? "";
    if (!bySection.has(key)) bySection.set(key, []);
    bySection.get(key)!.push(route);
  }
  // Named sections first (discovery order), ungrouped routes last.
  const sections = [...bySection.entries()].sort((a, b) => (a[0] === "" ? 1 : b[0] === "" ? -1 : 0));
  const hasNamedSections = sections.some(([name]) => name !== "");

  const out: FrameSpec[] = [];
  let yOffset = 0;
  for (const [name, sectionRoutes] of sections) {
    // Ungrouped routes only get a label when they sit beside named sections.
    const section = name !== "" ? name : hasNamedSections ? "Screens" : undefined;
    sectionRoutes.forEach((route, i) => {
      out.push({
        kind: "route" as const,
        title: route.title ?? (route.path === "/" ? "Home" : route.path.split("/").filter(Boolean).join(" / ")),
        routePath: route.path,
        section,
        x: (i % cols) * (width + gapX),
        y: yOffset + Math.floor(i / cols) * (height + gapY),
        width,
        height,
      });
    });
    const rows = Math.ceil(sectionRoutes.length / cols);
    yOffset += rows * (height + gapY) + sectionGap;
  }
  return out;
}
