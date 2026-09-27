// dev-server.mjs — zero-dependency local dev server for SnapCal Web.
// Serves the static app and executes api/gemini.js with the same
// (req.body, res.status().json()) interface Vercel's Node runtime provides,
// reading secrets from ./.env. Not used in production — Vercel replaces it.
//
//   node dev-server.mjs          → http://localhost:3000
//   PORT=8080 node dev-server.mjs

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
// Local dev has no accounts database, so the API gate is opened explicitly here (see api/_auth.js).
process.env.ALLOW_ANONYMOUS = process.env.ALLOW_ANONYMOUS ?? "1";

const PORT = Number(process.env.PORT || 3000);

// Load ./.env into process.env (no override of pre-set vars).
try {
  const env = await readFile(join(ROOT, ".env"), "utf8");
  for (const line of env.split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
} catch {
  console.warn("no .env file found — /api/gemini will report a key error");
}

const { default: geminiHandler } = await import("./api/gemini.js");
const { default: syncHandler } = await import("./api/sync.js");
const { default: foodsHandler } = await import("./api/foods.js");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function vercelResShim(res) {
  return {
    status(code) {
      res.statusCode = code;
      return this;
    },
    json(payload) {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(payload));
    },
    setHeader: (...a) => res.setHeader(...a),
    end: (...a) => res.end(...a),
  };
}

// The same security headers Vercel sends (vercel.json), so a policy that breaks something
// shows up here first rather than on everyone's phones.
let SECURITY_HEADERS = [];
try {
  const cfg = JSON.parse(await readFile(join(ROOT, "vercel.json"), "utf8"));
  SECURITY_HEADERS = (cfg.headers ?? []).flatMap((h) => h.headers ?? []).filter((h) => h.key !== "Strict-Transport-Security");
} catch {
  // no vercel.json: serve without them
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  for (const h of SECURITY_HEADERS) res.setHeader(h.key, h.value);

  if (url.pathname === "/api/foods") {
    try {
      await foodsHandler(req, vercelResShim(res));
    } catch (err) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: false, errorType: "other", message: String(err) }));
    }
    return;
  }

  if (url.pathname === "/api/gemini" || url.pathname === "/api/sync") {
    const handler = url.pathname === "/api/gemini" ? geminiHandler : syncHandler;
    const chunks = [];
    for await (const c of req) chunks.push(c);
    req.body = Buffer.concat(chunks).toString("utf8");
    try {
      await handler(req, vercelResShim(res));
    } catch (err) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ errorType: "other", message: String(err) }));
    }
    return;
  }

  let path = url.pathname === "/" ? "/index.html" : url.pathname;
  path = normalize(path).replace(/^(\.\.[/\\])+/, "");
  try {
    const data = await readFile(join(ROOT, path));
    res.setHeader("Content-Type", MIME[extname(path)] || "application/octet-stream");
    res.end(data);
  } catch {
    res.statusCode = 404;
    res.end("Not found");
  }
});

server.listen(PORT, () => {
  console.log(`SnapCal Web → http://localhost:${PORT}`);
});
