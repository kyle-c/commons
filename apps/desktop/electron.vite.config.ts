import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  main: {
    // Workspace packages are bundled in (no symlinked node_modules in the
    // packaged app); real deps like the Claude Agent SDK stay external.
    plugins: [externalizeDepsPlugin({ exclude: ["@commons/shared"] })],
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ["@commons/shared"] })],
  },
  renderer: {
    // The desktop app loads its bundle from file://, so asset URLs resolve
    // relative to the script (electron-vite pins base to "./" for renderer
    // builds and ignores overrides). The web build (scripts/publish-webapp.mjs)
    // sets COMMONS_RENDERER_BASE=/app/: there the script is served from Convex
    // storage after a redirect, and a script-relative URL lands on that
    // storage origin (bogus paths for sticker art, fonts, the favicon). So in
    // JS, write assets as page-relative "/app/assets/..." instead.
    ...(process.env.COMMONS_RENDERER_BASE
      ? {
          experimental: {
            renderBuiltUrl: (filename: string, { hostType }: { hostType: "js" | "css" | "html" }) =>
              hostType === "js" ? process.env.COMMONS_RENDERER_BASE + filename : { relative: true },
          },
        }
      : {}),
    plugins: [react()],
    resolve: {
      alias: {
        "@": resolve(__dirname, "src/renderer/src"),
      },
    },
  },
});
