import { describe, expect, it } from "vitest";
import { draftPreviewUrl, parseDeepLink, buildDeepLink } from "./index";

describe("draftPreviewUrl", () => {
  it("slugs the branch into the pattern like the host does", () => {
    expect(draftPreviewUrl("https://app-git-{branch}-team.vercel.app", "Feature/New_Nav")).toBe(
      "https://app-git-feature-new-nav-team.vercel.app"
    );
  });
  it("strips a trailing slash from the result", () => {
    expect(draftPreviewUrl("https://app.example.com/{branch}/", "wip")).toBe("https://app.example.com/wip");
  });
});

describe("parseDeepLink / buildDeepLink round-trip", () => {
  it("round-trips a canvas link with frame and thread", () => {
    const link = { projectId: "p1", view: "canvas" as const, frameId: "f1", threadId: "t1" };
    const parsed = parseDeepLink(buildDeepLink(link));
    expect(parsed).toEqual(link);
  });

  it("round-trips a flow link (regression: parseDeepLink once rejected flow)", () => {
    const link = { projectId: "p1", view: "flow" as const };
    expect(parseDeepLink(buildDeepLink(link))).toEqual(link);
  });

  it("rejects a non-commons protocol", () => {
    expect(parseDeepLink("https://evil.example.com/project/p1/canvas")).toBeNull();
  });

  it("rejects a malformed link", () => {
    expect(parseDeepLink("not a url")).toBeNull();
    expect(parseDeepLink("commons://project//canvas")).toBeNull();
  });
});
