// Lays out the static site Vercel serves from dist/:
//   /          the chatImbored hub (hub/index.html)
//   /classic/  the Godot Web export (client-godot/builds/web/)
//   /play/     Morbid Masquerade, built into dist/play by the next step of vercel-build
import { cpSync, rmSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const out = join(root, "dist");
const godot = join(root, "client-godot", "builds", "web");

rmSync(out, { recursive: true, force: true });
cpSync(godot, join(out, "classic"), {
  recursive: true,
  filter: (source) => !source.startsWith(join(godot, "play")),
});
cpSync(join(root, "hub", "index.html"), join(out, "index.html"));

console.log("Assembled dist/: hub at /, Godot games at /classic/.");
