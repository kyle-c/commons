import { describe, expect, it } from "vitest";
import { planMoves, type Spot } from "./flip";

const layout = (entries: Record<string, [number, number]>): Map<string, Spot> =>
  new Map(Object.entries(entries).map(([id, [left, top]]) => [id, { left, top }]));

describe("planMoves", () => {
  it("reports the distance back to where a card used to be", () => {
    // FLIP inverts: a card that moved left and up is transformed the other way
    // so it starts where the eye last saw it.
    const moves = planMoves(layout({ a: [300, 200] }), layout({ a: [100, 50] }));
    expect(moves).toEqual([{ id: "a", dx: 200, dy: 150 }]);
  });

  it("closes the gap an archived card leaves: later cards shift up one row", () => {
    const before = layout({ a: [0, 0], b: [220, 0], c: [0, 180], d: [220, 180] });
    // 'b' archived; c and d each move into the slot ahead of them.
    const after = layout({ a: [0, 0], c: [220, 0], d: [0, 180] });
    const moves = planMoves(before, after);
    expect(moves.map((m) => m.id).sort()).toEqual(["c", "d"]);
    // c came from the row below, so it is pulled back down to start.
    expect(moves.find((m) => m.id === "c")).toEqual({ id: "c", dx: -220, dy: 180 });
    expect(moves.find((m) => m.id === "d")).toEqual({ id: "d", dx: 220, dy: 0 });
  });

  it("leaves the card that did not move alone", () => {
    const moves = planMoves(layout({ a: [0, 0], b: [220, 0] }), layout({ a: [0, 0] }));
    expect(moves).toEqual([]);
  });

  it("ignores sub-pixel drift", () => {
    // A scrollbar appearing or a font settling nudges everything a hair; that
    // is not movement and animating it makes an idle grid shimmer.
    const moves = planMoves(layout({ a: [100, 100] }), layout({ a: [100.9, 99.2] }));
    expect(moves).toEqual([]);
  });

  it("does not animate a card it has never seen", () => {
    // An entrance is a different animation. Archived cards deliberately carry
    // a different id from their live card for exactly this reason.
    const moves = planMoves(layout({ a: [0, 0] }), layout({ a: [0, 0], "archived-a": [0, 400] }));
    expect(moves).toEqual([]);
  });

  it("forgets cards that left, so a returning id is an entrance again", () => {
    const gone = planMoves(layout({ a: [0, 0], b: [220, 0] }), layout({ a: [0, 0] }));
    expect(gone).toEqual([]);
    // 'b' restored somewhere else: no stale position to fly in from.
    const back = planMoves(layout({ a: [0, 0] }), layout({ a: [0, 0], b: [220, 360] }));
    expect(back).toEqual([]);
  });
});
