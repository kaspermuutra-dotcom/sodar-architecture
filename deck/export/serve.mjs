/* Minimal static server with HTTP Range support (Chrome needs ranges to seek <video>).
   usage: node deck/export/serve.mjs [port] [dir]   — defaults: 4174, the deck folder */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const port = Number((isMain && process.argv[2]) || 4174);
const root = path.resolve((isMain && process.argv[3]) || path.join(path.dirname(fileURLToPath(import.meta.url)), ".."));
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".mp4": "video/mp4", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json", ".woff2": "font/woff2" };

export function start(p = port, dir = root) {
  const server = http.createServer((req, res) => {
    let url = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (url.endsWith("/")) url += "index.html";
    const file = path.normalize(path.join(dir, url));
    if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end("not found"); }
    const size = fs.statSync(file).size, type = types[path.extname(file).toLowerCase()] || "application/octet-stream";
    const range = req.headers.range && /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    res.setHeader("Accept-Ranges", "bytes"); res.setHeader("Content-Type", type); res.setHeader("Cache-Control", "no-cache");
    if (range) {
      const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      if (start >= size) { res.writeHead(416, { "Content-Range": `bytes */${size}` }); return res.end(); }
      res.writeHead(206, { "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": end - start + 1 });
      if (req.method === "HEAD") return res.end();
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { "Content-Length": size });
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(p, "127.0.0.1", () => resolve(server)));
}

if (isMain) {
  start().then(() => console.log(`deck (with Range support) at http://localhost:${port}/  root ${root}`));
}
