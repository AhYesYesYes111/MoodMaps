import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const extensionRoot = path.join(projectRoot, "extension");
const outputRoot = path.join(projectRoot, "store-assets");
const uiRoot = path.join(outputRoot, "ui");
const screenshotsRoot = path.join(outputRoot, "screenshots");
const promoRoot = path.join(outputRoot, "promotional");
const nodeRuntimeRoot =
  "/Users/henry/.cache/codex-runtimes/codex-primary-runtime/dependencies";
const playwrightModule = path.join(
  nodeRuntimeRoot,
  "node/node_modules/playwright/index.mjs"
);
const nodeBin = path.join(nodeRuntimeRoot, "node/bin/node");
const viteBin = path.join(extensionRoot, "node_modules/vite/bin/vite.js");
const chromePath =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

await Promise.all([
  mkdir(uiRoot, { recursive: true }),
  mkdir(screenshotsRoot, { recursive: true }),
  mkdir(promoRoot, { recursive: true })
]);

const vite = spawn(nodeBin, [viteBin, "--host", "127.0.0.1", "--port", "4173"], {
  cwd: extensionRoot,
  env: {
    ...process.env,
    PATH: path.join(nodeRuntimeRoot, "node/bin") + ":" + process.env.PATH
  },
  stdio: ["ignore", "pipe", "pipe"]
});

let viteLog = "";
vite.stdout.on("data", (chunk) => {
  viteLog += chunk.toString();
});
vite.stderr.on("data", (chunk) => {
  viteLog += chunk.toString();
});

async function waitForVite() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch("http://127.0.0.1:4173/store-capture.html");
      if (response.ok) return;
    } catch {
      // Vite is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Vite did not start in time.\n" + viteLog);
}

const { chromium } = await import(pathToFileURL(playwrightModule).href);
let browser;

try {
  await waitForVite();
  browser = await chromium.launch({
    executablePath: chromePath,
    headless: true,
    args: ["--hide-scrollbars", "--force-device-scale-factor=1"]
  });

  const popupPage = await browser.newPage({ viewport: { width: 400, height: 600 } });
  const popupDiagnostics = [];
  popupPage.on("console", (message) => {
    popupDiagnostics.push(`console ${message.type()}: ${message.text()}`);
  });
  popupPage.on("pageerror", (error) => {
    popupDiagnostics.push(`pageerror: ${error.message}`);
  });
  await popupPage.goto("http://127.0.0.1:4173/store-capture.html", {
    waitUntil: "networkidle"
  });
  try {
    await popupPage.locator(".selected-score").waitFor({ timeout: 10000 });
  } catch (error) {
    throw new Error(
      `${error.message}\n${popupDiagnostics.join("\n")}\n` +
        (await popupPage.locator("body").innerText())
    );
  }
  await popupPage.screenshot({
    path: path.join(uiRoot, "popup-results.png"),
    fullPage: false
  });
  await popupPage.close();

  const designUrl = pathToFileURL(
    path.join(outputRoot, "source", "design.html")
  ).href;
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  for (let index = 1; index <= 5; index += 1) {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(designUrl + "?asset=" + index, { waitUntil: "networkidle" });
    await page.screenshot({
      path: path.join(
        screenshotsRoot,
        `moodmaps-store-screenshot-${index}-1280x800.png`
      ),
      fullPage: false
    });
  }

  await page.setViewportSize({ width: 440, height: 280 });
  await page.goto(designUrl + "?asset=small", { waitUntil: "networkidle" });
  await page.screenshot({
    path: path.join(promoRoot, "moodmaps-small-promo-440x280.png"),
    fullPage: false
  });

  await page.setViewportSize({ width: 1400, height: 560 });
  await page.goto(designUrl + "?asset=marquee", { waitUntil: "networkidle" });
  await page.screenshot({
    path: path.join(promoRoot, "moodmaps-marquee-1400x560.png"),
    fullPage: false
  });
  await page.close();
} finally {
  if (browser) await browser.close();
  vite.kill("SIGTERM");
}
