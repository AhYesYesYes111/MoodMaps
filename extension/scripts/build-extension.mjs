import { build } from "esbuild";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const root = resolve(process.cwd());
const dist = resolve(root, "dist");

await build({
  entryPoints: [resolve(root, "src/background/service-worker.ts")],
  outfile: resolve(dist, "service-worker.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "chrome116",
  minify: true
});

await build({
  entryPoints: [resolve(root, "src/content/content-script.ts")],
  outfile: resolve(dist, "content-script.js"),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "chrome116",
  minify: true
});

const assets = [
  ["public/manifest.json", "manifest.json"],
  ["public/content-script.css", "content-script.css"],
  ["public/icons/icon16.png", "icons/icon16.png"],
  ["public/icons/icon32.png", "icons/icon32.png"],
  ["public/icons/icon48.png", "icons/icon48.png"],
  ["public/icons/icon128.png", "icons/icon128.png"]
];

for (const [source, target] of assets) {
  const output = resolve(dist, target);
  await mkdir(dirname(output), { recursive: true });
  await copyFile(resolve(root, source), output);
}

const manifestPath = resolve(dist, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const packageJson = JSON.parse(
  await readFile(resolve(root, "package.json"), "utf8")
);
manifest.version = packageJson.version;
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
