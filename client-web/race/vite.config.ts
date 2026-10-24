import { defineConfig } from "vite";

// Pile-Up is its own page. It shares the server connection and controller code in ../src and the protocol in ../../shared.
export default defineConfig({
  server: { fs: { allow: ["../.."] } },
  build: { target: "es2022" },
});
