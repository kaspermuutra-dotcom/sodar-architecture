/* Render the solution film to an MP4 by driving deck.js's renderAt(t) frame by frame in
   headless Chrome and piping JPEG frames into ffmpeg.
   usage: node export/render.mjs [--fps 30] [--out ../site/public/media/intro.mp4] [--width 1280]
   requires: deck served at http://localhost:4173 (python3 -m http.server 4173 -d deck) */
import puppeteer from "puppeteer-core";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith("--") ? [a.slice(2), all[i + 1]] : [])).filter((x) => x.length));
const FPS = Number(args.fps || 30);
const WIDTH = Number(args.width || 1280);
const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, args.out || "../../site/public/media/intro.mp4");
const URL = args.url || "http://localhost:4173/?export=1&motion=off#3";
const CHROME = args.chrome || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--autoplay-policy=no-user-gesture-required", "--hide-scrollbars", "--force-device-scale-factor=1"] });
const page = await browser.newPage();
await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
await page.goto(URL, { waitUntil: "load", timeout: 90000 });
await page.waitForFunction(() => window.sodarDeck && window.sodarDeck.film);
const total = await page.evaluate(() => window.sodarDeck.film.prepareExport());
const frames = Math.ceil(total * FPS);
console.log(`film ${total.toFixed(2)}s → ${frames} frames @ ${FPS}fps → ${OUT}`);

const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-i", "-",
  "-vf", `scale=${WIDTH}:-2:flags=lanczos`, "-c:v", "libx264", "-preset", "slow", "-crf", "21", "-pix_fmt", "yuv420p", "-movflags", "+faststart", OUT], { stdio: ["pipe", "inherit", "inherit"] });
const write = (buf) => new Promise((res) => (ff.stdin.write(buf) ? res() : ff.stdin.once("drain", res)));

const t0 = Date.now();
for (let f = 0; f < frames; f++) {
  const t = f / FPS;
  await page.evaluate((tt) => window.sodarDeck.film.renderAt(tt, true), t);
  const buf = await page.screenshot({ type: "jpeg", quality: 92, encoding: "binary" });
  await write(buf);
  if (f % (FPS * 5) === 0) console.log(`  ${t.toFixed(1)}s / ${total.toFixed(1)}s  (${((Date.now() - t0) / 1000).toFixed(0)}s elapsed)`);
}
ff.stdin.end();
await new Promise((res) => ff.on("close", res));
await browser.close();
console.log("done");
