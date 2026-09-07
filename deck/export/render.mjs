/* Render the solution film to an MP4 by driving deck.js's renderAt(t) frame by frame in
   headless Chrome and piping JPEG frames into ffmpeg.
   usage: node export/render.mjs [--fps 30] [--out ../site/public/media/intro.mp4] [--width 1280] [--file]
   starts its own Range-capable static server (serve.mjs) on --port (default 4174); pass --url to use another cut */
import puppeteer from "puppeteer-core";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { start as serve } from "./serve.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith("--") ? [a.slice(2), all[i + 1]] : [])).filter((x) => x.length));
const FPS = Number(args.fps || 30);
const WIDTH = Number(args.width || 1280);
const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, args.out || "../../site/public/media/intro.mp4");
const PORT = Number(args.port || 4174);
const FILE = process.argv.includes("--file"); // --file: load the deck over file:// (no server, no listening port — works inside sandboxes)
const URL = args.url || (FILE ? `file://${path.resolve(here, "../index.html")}?export=1&motion=off&cut=web#3` : `http://localhost:${PORT}/?export=1&motion=off&cut=web#3`);
const CHROME = args.chrome || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const server = FILE ? null : await serve(PORT); // Range-capable static server: Chrome cannot seek <video> over http without it
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, pipe: true, userDataDir: path.join(process.env.TMPDIR || "/tmp", `sodar-render-${process.pid}`), args: ["--allow-file-access-from-files", "--autoplay-policy=no-user-gesture-required", "--hide-scrollbars", "--force-device-scale-factor=1"] });
const page = await browser.newPage();
page.on("pageerror", (e) => console.error("page error:", e.message));
page.on("console", (m) => { if (m.type() === "error") console.error("console:", m.text()); });
page.on("response", (res) => { if (res.status() >= 400) console.error("http", res.status(), res.url()); });
await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
await page.goto(URL, { waitUntil: "load", timeout: 90000 });
console.log("loaded", page.url());
for (let i = 0; i < 240; i++) { if (await page.evaluate(() => !!(window.sodarDeck && window.sodarDeck.film))) break; await new Promise((r) => setTimeout(r, 250)); }
if (!(await page.evaluate(() => !!(window.sodarDeck && window.sodarDeck.film)))) throw new Error("deck did not initialise");
const total = await page.evaluate(() => window.sodarDeck.film.prepareExport());
const FROM = Number(args.from || 0), TO = Math.min(total, Number(args.to || total));
const f0 = Math.floor(FROM * FPS), f1 = Math.ceil(TO * FPS), frames = f1 - f0;
console.log(`film ${total.toFixed(2)}s, rendering ${FROM}s–${TO.toFixed(2)}s → ${frames} frames @ ${FPS}fps → ${OUT}`);

const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-i", "-",
  "-vf", `scale=${WIDTH}:-2:flags=lanczos`, "-c:v", "libx264", "-preset", "slow", "-crf", "21", "-pix_fmt", "yuv420p", "-movflags", "+faststart", OUT], { stdio: ["pipe", "inherit", "inherit"] });
const write = (buf) => new Promise((res) => (ff.stdin.write(buf) ? res() : ff.stdin.once("drain", res)));

const t0 = Date.now();
for (let f = f0; f < f1; f++) {
  const t = f / FPS;
  await page.evaluate((tt) => window.sodarDeck.film.renderAt(tt, true), t);
  const buf = await page.screenshot({ type: "jpeg", quality: 92, encoding: "binary" });
  await write(buf);
  if ((f - f0) % (FPS * 5) === 0) console.log(`  ${t.toFixed(1)}s / ${TO.toFixed(1)}s  (${((Date.now() - t0) / 1000).toFixed(0)}s elapsed)`);
}
ff.stdin.end();
await new Promise((res) => ff.on("close", res));
await browser.close();
if (server) server.close();
console.log("done");
