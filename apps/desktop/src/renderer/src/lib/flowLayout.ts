/**
 * Layered left-to-right layout for the Flow view: entry screens in the first
 * column, each subsequent column one navigation step deeper, edges flowing
 * rightward. The classic sitemap shape, computed instead of drawn.
 *
 * Deliberately not a general graph engine. Screens per project number in the
 * dozens, so a BFS layering with column packing reads better than a force
 * simulation and never jiggles. Cycles (back-navigation) are fine: a node's
 * depth is its FIRST discovery depth, and the return edge simply curves back.
 */

export interface FlowNode {
  id: string;
  width: number;
  height: number;
  routePath?: string;
}

export interface FlowEdgeInput {
  fromFrameId: string;
  toFrameId: string;
}

const COLUMN_GAP = 220;
const ROW_GAP = 110;
const ORIGIN_X = 120;
const ORIGIN_Y = 120;

export function flowPositions(
  nodes: FlowNode[],
  edges: FlowEdgeInput[]
): Record<string, { x: number; y: number }> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  for (const n of nodes) {
    out.set(n.id, []);
    inDegree.set(n.id, 0);
  }
  for (const e of edges) {
    if (!byId.has(e.fromFrameId) || !byId.has(e.toFrameId)) continue;
    out.get(e.fromFrameId)!.push(e.toFrameId);
    inDegree.set(e.toFrameId, (inDegree.get(e.toFrameId) ?? 0) + 1);
  }

  // Roots: the home route if it participates, then anything nothing points
  // at, then (fully cyclic graphs) an arbitrary node so layout never fails.
  const connected = nodes.filter((n) => (out.get(n.id)?.length ?? 0) > 0 || (inDegree.get(n.id) ?? 0) > 0);
  const roots = connected.filter((n) => n.routePath === "/" || inDegree.get(n.id) === 0);
  const seeds = roots.length > 0 ? roots : connected.slice(0, 1);

  const depth = new Map<string, number>();
  const queue: string[] = [];
  for (const r of seeds) {
    depth.set(r.id, 0);
    queue.push(r.id);
  }
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const next of out.get(id) ?? []) {
      if (!depth.has(next)) {
        depth.set(next, depth.get(id)! + 1);
        queue.push(next);
      }
    }
  }
  // Connected-but-unreached (pointed at from a cycle BFS missed): tack on.
  for (const n of connected) if (!depth.has(n.id)) depth.set(n.id, 1);

  // Columns: pack each depth top-to-bottom, x advances by the widest node.
  const columns = new Map<number, FlowNode[]>();
  for (const n of connected) {
    const d = depth.get(n.id)!;
    if (!columns.has(d)) columns.set(d, []);
    columns.get(d)!.push(n);
  }

  const positions: Record<string, { x: number; y: number }> = {};
  let x = ORIGIN_X;
  const depths = [...columns.keys()].sort((a, b) => a - b);
  const tallest = Math.max(
    1,
    ...depths.map((d) => columns.get(d)!.reduce((sum, n) => sum + n.height + ROW_GAP, -ROW_GAP))
  );
  for (const d of depths) {
    const column = columns.get(d)!;
    column.sort((a, b) => (a.routePath ?? "").localeCompare(b.routePath ?? ""));
    const columnHeight = column.reduce((sum, n) => sum + n.height + ROW_GAP, -ROW_GAP);
    let y = ORIGIN_Y + Math.max(0, (tallest - columnHeight) / 2);
    for (const n of column) {
      positions[n.id] = { x, y };
      y += n.height + ROW_GAP;
    }
    x += Math.max(...column.map((n) => n.width)) + COLUMN_GAP;
  }

  // Screens no tester ever reached: parked in a labeled row below the graph,
  // visibly disconnected rather than hidden. Absence of evidence is a fact
  // about the flows, and hiding the unreached screens would bury it.
  const orphans = nodes.filter((n) => !(n.id in positions));
  let ox = ORIGIN_X;
  const oy = ORIGIN_Y + tallest + ROW_GAP * 2;
  for (const n of orphans) {
    positions[n.id] = { x: ox, y: oy };
    ox += n.width + 80;
  }

  return positions;
}
