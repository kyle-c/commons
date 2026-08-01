import { defineConfig } from "vitest/config";

/**
 * Unit tests for the pure, deterministic logic that no type checker can prove
 * correct: branch-pattern inference, URL slugging, graph layout, deep-link
 * parsing. These are the functions whose bugs ship silently — a wrong preview
 * URL, a mislaid flow node — so they are the first covered (ARCHITECTURE.md
 * §5, High #2). Anything needing the Convex runtime, Electron, or the DOM is
 * out of scope here by design; this stays a fast, dependency-free suite.
 */
export default defineConfig({
  test: {
    include: ["**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/out/**"],
    environment: "node",
  },
});
