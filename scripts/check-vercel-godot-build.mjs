import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const outputDir = join(process.cwd(), "client-godot", "builds", "web");
const requiredFiles = ["index.html"];
const requiredExtensions = [".wasm", ".pck", ".js"];

function fail(message) {
  console.error(`Vercel Godot Web build check failed: ${message}`);
  console.error("Export the Godot Web preset to client-godot/builds/web/ before deploying the static client.");
  process.exit(1);
}

if (!existsSync(outputDir)) {
  fail("client-godot/builds/web/ does not exist.");
}

const files = readdirSync(outputDir);

for (const file of requiredFiles) {
  if (!files.includes(file)) {
    fail(`${file} is missing from client-godot/builds/web/.`);
  }
}

for (const extension of requiredExtensions) {
  if (!files.some((file) => file.endsWith(extension))) {
    fail(`no ${extension} file was found in client-godot/builds/web/.`);
  }
}

console.log("Godot Web export found in client-godot/builds/web/.");
