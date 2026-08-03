import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);
const realScreenshots = path.join(projectRoot, "store-assets", "real-screenshots");
const runtimeRequire = createRequire(
  "/Users/henry/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json"
);
const sharp = runtimeRequire("sharp");

const crops = [
  ["google-maps-routes-full.png", "google-maps-routes-content.png"],
  ["apple-maps-routes-full.png", "apple-maps-routes-content.png"]
];

for (const [inputName, outputName] of crops) {
  await sharp(path.join(realScreenshots, inputName))
    .extract({ left: 0, top: 75, width: 1314, height: 693 })
    .png()
    .toFile(path.join(realScreenshots, outputName));
}
