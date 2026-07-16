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
    plugins: [react()],
    resolve: {
      alias: {
        "@": resolve(__dirname, "src/renderer/src"),
      },
    },
  },
});
