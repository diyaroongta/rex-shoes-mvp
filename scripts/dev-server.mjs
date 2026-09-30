/* LOCAL DEV WITHOUT THE VERCEL CLI.
 *
 * `npm run dev` is `vercel dev`, which needs the CLI installed AND the folder
 * linked to the Vercel project. Without either, there was no way to run the
 * app locally with its API at all. This serves the page through Vite and
 * mounts each `api/*.js` handler the way Vercel's Node runtime does: the
 * filename is the route, `[param].js` is a path parameter, the query string
 * and the JSON body arrive parsed, and `res.status().json()` works.
 *
 * AUTH_SECRET: taken from the environment / .env.local if set. Otherwise a
 * random one is made for THIS process only, so sessions last until restart
 * and nothing is ever written anywhere. The database is whatever
 * DATABASE_URL says — usually the live one, so treat writes as real.
 *
 *   node scripts/dev-server.mjs            (port 5173)
 */
import { createServer as createVite } from "vite";
import http from "node:http";
import { randomBytes } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadEnvLocal } from "./env-local.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
loadEnvLocal();
if(!process.env.AUTH_SECRET || process.env.AUTH_SECRET.length < 32){
  process.env.AUTH_SECRET = randomBytes(32).toString("hex");
  console.log("AUTH_SECRET not set — using a random one for this run only.");
}

const BODY_LIMIT = 4.5 * 1024 * 1024;     // Vercel's own request cap

/* /api/orders -> api/orders/index.js, /api/orders/JO1 -> api/orders/[order_no].js */
function resolveRoute(pathname){
  const parts = pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  const dir = join(root, "api", ...parts.slice(0, -1));
  const last = parts[parts.length - 1];
  if(!last) return existsSync(join(root, "api", "index.js")) ? { file: join(root, "api", "index.js"), params: {} } : null;
  if(last.startsWith("_")) return null;                       // api/_lib is not routable on Vercel either
  for(const f of [join(dir, `${last}.js`), join(dir, last, "index.js")])
    if(existsSync(f)) return { file: f, params: {} };
  if(existsSync(dir)){
    const dyn = readdirSync(dir).find(n => /^\[[^\]]+\]\.js$/.test(n));
    if(dyn) return { file: join(dir, dyn), params: { [dyn.slice(1, -4)]: last } };
  }
  return null;
}

function readBody(req){
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on("data", c => { size += c.length; if(size > BODY_LIMIT){ reject(Object.assign(new Error("Request body too large"), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function api(req, res){
  const url = new URL(req.url, "http://localhost");
  const route = resolveRoute(url.pathname);
  res.status = code => { res.statusCode = code; return res; };
  res.json = obj => { if(!res.getHeader("content-type")) res.setHeader("content-type", "application/json"); res.end(JSON.stringify(obj)); return res; };
  res.send = body => { typeof body === "object" && !Buffer.isBuffer(body) ? res.json(body) : res.end(body); return res; };
  if(!route) return res.status(404).json({ error: `No API route for ${url.pathname}` });
  try{
    const raw = await readBody(req);
    const type = String(req.headers["content-type"] || "");
    req.body = raw && type.includes("application/json") ? JSON.parse(raw) : (raw || undefined);
  }catch(e){ return res.status(e.status || 400).json({ error: e.message }); }
  req.query = { ...Object.fromEntries(url.searchParams), ...route.params };
  /* Re-import on every request so an edit to a handler takes effect without a
     restart, which is what `vercel dev` does too. */
  const mod = await import(pathToFileURL(route.file).href + `?t=${Date.now()}`);
  await mod.default(req, res);
}

const vite = await createVite({ root, server: { middlewareMode: true }, appType: "spa" });
const port = Number(process.env.PORT) || 5173;
http.createServer((req, res) => {
  if(req.url.startsWith("/api/") || req.url === "/api"){
    api(req, res).catch(e => { console.error(e); if(!res.headersSent) res.statusCode = 500; res.end(JSON.stringify({ error: String(e.message || e) })); });
    return;
  }
  vite.middlewares(req, res);
}).listen(port, () => console.log(`Factory OS on http://localhost:${port}  (database: ${
  (process.env.DATABASE_URL || "").replace(/.*@([^/:?]+).*/, "$1") || "NOT SET"})`));
