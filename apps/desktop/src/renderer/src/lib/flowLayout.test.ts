import { describe, expect, it } from "vitest";
import { flowPositions, type FlowNode } from "./flowLayout";

const node = (id: string, routePath?: string): FlowNode => ({ id, width: 200, height: 150, routePath });

describe("flowPositions", () => {
  it("places a linear flow in left-to-right columns by depth", () => {
    const nodes = [node("a", "/"), node("b", "/two"), node("c", "/three")];
    const edges = [
      { fromFrameId: "a", toFrameId: "b" },
      { fromFrameId: "b", toFrameId: "c" },
    ];
    const pos = flowPositions(nodes, edges);
    expect(pos.a.x).toBeLessThan(pos.b.x);
    expect(pos.b.x).toBeLessThan(pos.c.x);
  });

  it("roots at the home route '/' even if something points at it", () => {
    // A back-edge to home must not push home out of the first column.
    const nodes = [node("home", "/"), node("detail", "/d")];
    const edges = [
      { fromFrameId: "home", toFrameId: "detail" },
      { fromFrameId: "detail", toFrameId: "home" },
    ];
    const pos = flowPositions(nodes, edges);
    expect(pos.home.x).toBeLessThan(pos.detail.x);
  });

  it("never diverges on a fully cyclic graph (no acyclic root)", () => {
    const nodes = [node("a", "/a"), node("b", "/b")];
    const edges = [
      { fromFrameId: "a", toFrameId: "b" },
      { fromFrameId: "b", toFrameId: "a" },
    ];
    const pos = flowPositions(nodes, edges);
    expect(Object.keys(pos).sort()).toEqual(["a", "b"]);
    expect(Number.isFinite(pos.a.x)).toBe(true);
    expect(Number.isFinite(pos.b.x)).toBe(true);
  });

  it("parks screens no edge ever reached below the graph, not on top of it", () => {
    const nodes = [node("a", "/"), node("b", "/two"), node("orphan", "/never")];
    const edges = [{ fromFrameId: "a", toFrameId: "b" }];
    const pos = flowPositions(nodes, edges);
    const graphBottom = Math.max(pos.a.y + 150, pos.b.y + 150);
    expect(pos.orphan.y).toBeGreaterThan(graphBottom);
  });

  it("positions every node exactly once", () => {
    const nodes = [node("a", "/"), node("b"), node("c"), node("d")];
    const edges = [
      { fromFrameId: "a", toFrameId: "b" },
      { fromFrameId: "a", toFrameId: "c" },
    ];
    const pos = flowPositions(nodes, edges);
    expect(Object.keys(pos).sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("ignores edges that reference unknown frames", () => {
    const nodes = [node("a", "/")];
    const edges = [{ fromFrameId: "a", toFrameId: "ghost" }];
    expect(() => flowPositions(nodes, edges)).not.toThrow();
  });
});
