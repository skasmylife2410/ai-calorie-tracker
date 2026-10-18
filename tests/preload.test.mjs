// preload.test.mjs — index.html asks for every module the first screen imports at once
// (<link rel="modulepreload">), instead of the browser finding them one import at a time. A new
// import that isn't listed would quietly bring that wait back, so the list must match the graph.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(resolve(root, "index.html"), "utf8");

/** Every module reachable from the entries through static imports (not import()), root-relative. */
function staticGraph(entries) {
  const seen = new Set();
  const visit = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/^\s*(?:import|export)\s+(?:[^'";]*?\s+from\s+)?["'](\.{1,2}\/[^"']+)["']/gm)) visit(resolve(dirname(file), m[1]));
  };
  entries.forEach((e) => visit(resolve(root, e)));
  return [...seen].map((f) => "/" + relative(root, f).split("\\").join("/"));
}

test("index.html preloads exactly the modules the first screen imports", () => {
  const entries = [...html.matchAll(/<script type="module" src="([^"]+)"/g)].map((m) => m[1].slice(1));
  assert.ok(entries.includes("js/app.js"));
  const want = staticGraph(entries).filter((m) => !entries.includes(m.slice(1))).sort();
  const have = [...html.matchAll(/<link rel="modulepreload" href="([^"]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(have.filter((m) => !want.includes(m)), [], "preloaded but no longer imported");
  assert.deepEqual(want.filter((m) => !have.includes(m)), [], "imported but not preloaded: add a modulepreload line");
});

test("what's preloaded is also in the offline copy", () => {
  const sw = readFileSync(resolve(root, "sw.js"), "utf8");
  const shell = new Set([...sw.match(/const APP_SHELL = \[([\s\S]*?)\];/)[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]));
  const preloaded = [...html.matchAll(/<link rel="(?:modulepreload|preload)" href="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(preloaded.filter((p) => !shell.has(p)), []);
});
