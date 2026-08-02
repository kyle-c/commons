import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

/**
 * The delete cascade must sweep every table that points at a project.
 *
 * `projects.deleteArchived` hard-deletes across ~20 child tables and three
 * storage locations. Nothing in the type system connects "this table has a
 * projectId" to "the cascade handles it", so adding a table to the schema and
 * forgetting the cascade is a silent, permanent leak: orphaned rows, and blobs
 * in storage with nothing left pointing at them to ever find them again.
 *
 * That is not hypothetical. `flowStateProposals` and `flowCrawls` shipped in
 * Flow v2 and were both missed, so every archived project leaked its crawl
 * screenshots until it was caught by hand. This test is the compile-time link
 * that was missing — it reads the schema, reads the cascade, and fails on the
 * next one rather than after it has leaked in production.
 *
 * Deliberately source-text analysis rather than a Convex integration test.
 * The property worth guarding is "a human wrote this table into the cascade",
 * which is exactly a fact about the source; a runtime test would need seeded
 * rows in every table and would still only prove the tables it thought to
 * seed. This cannot pass by accident: a new table's name has to literally
 * appear in projects.ts.
 */

const convexDir = join(__dirname, "..", "convex");
const schemaSrc = readFileSync(join(convexDir, "schema.ts"), "utf8");
const cascadeSrc = readFileSync(join(convexDir, "projects.ts"), "utf8");

/** Every `name: defineTable({ ... })` block, paired with its body. */
function tableBlocks(source: string): { name: string; body: string }[] {
  return [...source.matchAll(/(\w+):\s*defineTable\(\{(.*?)\n {2}\}\)/gs)].map((m) => ({
    name: m[1],
    body: m[2],
  }));
}

/** Tables carrying a direct reference to a project. */
function projectChildTables(source: string): string[] {
  return tableBlocks(source)
    .filter(({ body }) => /projectId:\s*v\.id\("projects"\)/.test(body))
    .map(({ name }) => name);
}

describe("delete cascade coverage", () => {
  const children = projectChildTables(schemaSrc);

  it("finds the project-child tables in the schema", () => {
    // Guards the parser itself: if defineTable formatting changes and the
    // regex silently matches nothing, every coverage assertion below would
    // pass vacuously, which is the one way this file could lie.
    expect(children.length).toBeGreaterThan(10);
    expect(children).toContain("threads");
    expect(children).toContain("frames");
    expect(children).toContain("flowStateProposals");
  });

  it.each(
    // Sorted so a failure names the same table run to run.
    [...projectChildTables(schemaSrc)].sort()
  )("sweeps %s when a project is deleted", (table) => {
    expect(
      cascadeSrc.includes(`"${table}"`),
      `Table "${table}" references a project but never appears in projects.ts.\n` +
        `Add it to cascadeDeleteProject — to the directQueries list if it is a\n` +
        `plain child, or to its own step if it owns storage blobs or has\n` +
        `children of its own. Leaving it out leaks rows and blobs forever.`
    ).toBe(true);
  });

  it("sweeps the grandchildren that hang off those tables", () => {
    // These have no projectId of their own — they are reached through a
    // parent — so the schema scan above cannot see them. Named explicitly.
    for (const table of ["messages", "notifications", "agentEvents", "testSessions", "testEvents"]) {
      expect(cascadeSrc.includes(`"${table}"`), `Grandchild "${table}" is not swept`).toBe(true);
    }
  });

  it("deletes storage blobs, not just the rows pointing at them", () => {
    // The rows are recoverable-ish; a blob with nothing referencing it is
    // unreachable forever. Every blob-owning table needs a storage.delete.
    expect(cascadeSrc).toMatch(/storage\.delete/);
    // Failures here must not abort the sweep midway and strand the rest.
    const deletes = [...cascadeSrc.matchAll(/storage\.delete\([^)]*\)/g)];
    expect(deletes.length).toBeGreaterThan(0);
    for (const match of deletes) {
      const after = cascadeSrc.slice(match.index! + match[0].length, match.index! + match[0].length + 20);
      expect(after, `Unguarded storage.delete at offset ${match.index}`).toMatch(/\.catch\(/);
    }
  });
});
