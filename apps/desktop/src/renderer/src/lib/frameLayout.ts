import type { DiscoveredRoute, RepoInspection } from "@commons/shared";

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
  const gapX = mobile ? 80 : 120;
  const gapY = mobile ? 120 : 160;
  const cols = mobile ? 6 : 3;
  const sectionGap = Math.round(height * 0.45);

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
