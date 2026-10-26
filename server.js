// Backend tanpa dependensi (Node >= 18). Jalankan: node server.js
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dir = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const API = "https://app.kyzznekoo.my.id/api";
const KEY = process.env.XAPIKEY || "sk_xof_be913a02d41a391bc9659386e607ca3b";
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36",
  "X-apikey": KEY,
};
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css" };
const cache = new Map(); // cache sederhana: key -> { t, data }
const TTL = 10 * 60 * 1000;

const validLink = (u) => /^https:\/\/alightcreative\.com\/am\/share\//.test(u || "");
const send = (res, code, body, type = "application/json") => {
  res.writeHead(code, { "Content-Type": type });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};

// Cari URL http(s) pertama di dalam JSON, utamakan key yang namanya mengandung url/link/download
function findUrl(obj) {
  const hits = [];
  (function walk(o, k = "") {
    if (typeof o === "string" && /^https?:\/\//.test(o)) hits.push([k, o]);
    else if (o && typeof o === "object") for (const [kk, v] of Object.entries(o)) walk(v, kk);
  })(obj);
  const pref = hits.find(([k]) => /download|url|link/i.test(k));
  return (pref || hits[0] || [])[1];
}

async function callApi(endpoint, link) {
  const r = await fetch(`${API}${endpoint}?url=${encodeURIComponent(link)}`, { headers: HEADERS });
  if (!r.ok) throw new Error(`API ${endpoint} membalas ${r.status}`);
  return r;
}

async function handleDetail(link) {
  const hit = cache.get("d:" + link);
  if (hit && Date.now() - hit.t < TTL) return hit.data;
  const data = await (await callApi("/alightmotion/detail", link)).json();
  cache.set("d:" + link, { t: Date.now(), data });
  return data;
}

// Mengembalikan file paket (.alightmotion) sebagai Buffer
async function handleDownload(link) {
  const hit = cache.get("f:" + link);
  if (hit && Date.now() - hit.t < TTL) return hit.data;
  const r = await callApi("/download/am", link);
  let buf;
  if ((r.headers.get("content-type") || "").includes("json")) {
    const j = await r.json();
    const fileUrl = findUrl(j);
    if (!fileUrl) throw new Error("Respons API unduhan tidak berisi link file");
    const f = await fetch(fileUrl, { headers: { "User-Agent": HEADERS["User-Agent"] } });
    if (!f.ok) throw new Error(`Gagal mengunduh file (${f.status})`);
    buf = Buffer.from(await f.arrayBuffer());
  } else {
    buf = Buffer.from(await r.arrayBuffer());
  }
  cache.set("f:" + link, { t: Date.now(), data: buf });
  return buf;
}

http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  try {
    if (u.pathname === "/api/detail" || u.pathname === "/api/download") {
      const link = u.searchParams.get("url");
      if (!validLink(link)) return send(res, 400, { error: "Link harus berformat https://alightcreative.com/am/share/..." });
      if (u.pathname === "/api/detail") return send(res, 200, await handleDetail(link));
      return send(res, 200, await handleDownload(link), "application/octet-stream");
    }
    const file = u.pathname === "/" ? "index.html" : u.pathname.slice(1);
    const full = path.join(__dir, "public", path.normalize(file));
    if (!full.startsWith(path.join(__dir, "public")) || !fs.existsSync(full)) return send(res, 404, { error: "Tidak ditemukan" });
    send(res, 200, fs.readFileSync(full), MIME[path.extname(full)] || "application/octet-stream");
  } catch (e) {
    send(res, 502, { error: e.message });
  }
}).listen(PORT, () => console.log(`Buka http://localhost:${PORT}`));
