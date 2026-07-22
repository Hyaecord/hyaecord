import { build } from "esbuild";
import { cpSync, mkdirSync } from "node:fs";

const common = {
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  sourcemap: true,
  external: ["electron"],
  logLevel: "info"
};

await build({
  ...common,
  entryPoints: ["src/main/index.ts"],
  outfile: "dist/main/index.js"
});

await build({
  ...common,
  entryPoints: ["src/preload/index.ts"],
  outfile: "dist/preload/index.js"
});

await build({
  entryPoints: ["src/renderer/app.ts"],
  outfile: "dist/renderer/app.js",
  bundle: true,
  platform: "browser",
  format: "esm",
  target: "chrome120",
  sourcemap: true,
  logLevel: "info"
});

mkdirSync("dist/renderer", { recursive: true });
cpSync("src/renderer/index.html", "dist/renderer/index.html");
cpSync("src/renderer/styles.css", "dist/renderer/styles.css");
cpSync("src/i18n", "dist/i18n", { recursive: true });

console.log("build complete");
