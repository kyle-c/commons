import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { requireWebPattern, requireWebUrl } from "../convex/urls";

describe("addresses stored to be framed", () => {
  it("have to be web addresses", () => {
    expect(requireWebUrl("https://staging.example.com", "The preview URL")).toBe("https://staging.example.com");
    expect(requireWebUrl("http://localhost:3000", "The preview URL")).toBe("http://localhost:3000");
    for (const bad of ["javascript:alert(1)//x", "data:text/html,<script>1</script>", "staging.example.com", ""]) {
      expect(() => requireWebUrl(bad, "The preview URL"), bad).toThrow("The preview URL has to be a web address");
    }
  });

  it("judge a draft pattern as the address it becomes", () => {
    const pattern = "https://app-git-{branch}-team.vercel.app";
    expect(requireWebPattern(pattern, "The draft preview pattern")).toBe(pattern);
    expect(() => requireWebPattern("javascript:{branch}//x", "The draft preview pattern")).toThrow("has to be a web address");
    expect(() => requireWebPattern("{branch}", "The draft preview pattern")).toThrow("has to be a web address");
  });

  // The rule only holds where it is applied. These are the writes that put an
  // address where the canvas or the tester harness will frame it.
  it("are checked at every write that stores one", () => {
    const read = (file: string) => readFileSync(new URL(`../convex/${file}`, import.meta.url), "utf8");
    const body = (source: string, name: string) => {
      const start = source.indexOf(`export const ${name} = `);
      expect(start, name).toBeGreaterThan(-1);
      const next = source.indexOf("\nexport const ", start + 1);
      return source.slice(start, next === -1 ? undefined : next);
    };
    const setPreviewUrl = body(read("projects.ts"), "setPreviewUrl");
    expect(setPreviewUrl).toContain(`requireWebUrl(previewUrl, "The preview URL")`);
    expect(setPreviewUrl).toContain(`requireWebPattern(branchPreviewPattern, "The draft preview pattern")`);
    expect(setPreviewUrl.indexOf("requireWebUrl(")).toBeLessThan(setPreviewUrl.indexOf("ctx.db.patch("));
    const createTest = body(read("userTests.ts"), "create");
    expect(createTest).toContain(`requireWebUrl(args.variant.url, "The variant URL")`);
    expect(createTest.indexOf("requireWebUrl(")).toBeLessThan(createTest.indexOf("ctx.db.insert("));
    // Deploys arrive from GitHub, not from a form: refused quietly, before anything is written.
    const github = read("github.ts");
    const applyDeploy = github.slice(github.indexOf("async function applyDeploy("));
    expect(applyDeploy.indexOf("if (!isWebUrl(deploy.url)) return;")).toBeGreaterThan(-1);
    expect(applyDeploy.indexOf("if (!isWebUrl(deploy.url)) return;")).toBeLessThan(applyDeploy.indexOf("ctx.db.insert("));
  });
});
