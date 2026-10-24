import { defineConfig } from "vite";

// Scribble Scrap is its own page. It shares the server connection code in ../src and the protocol in ../../shared.
export default defineConfig({
  server: { fs: { allow: ["../.."] } },
  build: { target: "es2022" },
});
