import { defineConfig } from "vite";

export default defineConfig({
  // The client imports protocol types and movement rules from the sibling shared/ folder.
  server: { fs: { allow: [".."] } },
  build: { outDir: "dist", target: "es2022" },
});
