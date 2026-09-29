import { describe, expect, it } from "vitest";
import { coverCapacity, firstName, isPortrait, rankCoverFrames, type CoverFrameLike } from "../convex/coverScreens";

const frame = (id: string, over: Partial<CoverFrameLike> = {}): CoverFrameLike => ({
  _id: id,
  kind: "route",
  routePath: `/${id}`,
  x: 0,
  y: 0,
  width: 1440,
  height: 900,
  ...over,
});

describe("cover screens", () => {
  it("leads with the screen holding the newest open comment, then home, then reading order", () => {
    const frames = [
      frame("b", { x: 2000, y: 0 }),
      frame("home", { routePath: "/", x: 4000, y: 0 }),
      frame("a", { x: 0, y: 0 }),
      frame("c", { x: 0, y: 1200 }),
    ];
    expect(rankCoverFrames(frames, "c").map((f) => f._id)).toEqual(["c", "home", "a", "b"]);
    expect(rankCoverFrames(frames).map((f) => f._id)).toEqual(["home", "a", "b", "c"]);
  });

  it("never leads with deleted frames, copies, what-if variants, or states", () => {
    const frames = [
      frame("gone", { deletedAt: 1 }),
      frame("copy", { copyOf: "a" }),
      frame("whatif", { variantBranch: "commons/x" }),
      frame("state", { kind: "state" }),
      frame("a", { y: 50 }),
    ];
    expect(rankCoverFrames(frames, "gone").map((f) => f._id)).toEqual(["a"]);
  });

  it("shapes the table from the screens themselves: phones fan out three, wide screens stack two", () => {
    const phone = { width: 390, height: 844 };
    const desktop = { width: 1440, height: 900 };
    expect(isPortrait(phone)).toBe(true);
    expect(isPortrait(desktop)).toBe(false);
    expect(isPortrait({ width: 1000, height: 1050 })).toBe(false); // square-ish stays wide
    expect(coverCapacity(phone)).toBe(3);
    expect(coverCapacity(desktop)).toBe(2);
    expect(coverCapacity(undefined)).toBe(0);
  });

  it("names people by first name", () => {
    expect(firstName("Kyle Cooney")).toBe("Kyle");
    expect(firstName("  Maya  ")).toBe("Maya");
    expect(firstName("")).toBe("Someone");
  });
});
