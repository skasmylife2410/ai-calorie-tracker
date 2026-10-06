// sw.test.mjs — the offline copy must hold every file the app can load, or a file left out could
// come from a different deploy than the rest (and the app would break offline).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const sw = readFileSync(new URL("../sw.js", import.meta.url), "utf8");
const shell = new Set([...sw.match(/const APP_SHELL = \[([\s\S]*?)\];/)[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]));
const list = (dir, ext) => readdirSync(new URL(`../${dir}/`, import.meta.url)).filter((f) => f.endsWith(ext)).map((f) => `/${dir}/${f}`);

test("every script, stylesheet and language file is in the offline copy", () => {
  const missing = [...list("js", ".js"), ...list("js/ui", ".js"), ...list("css", ".css"), ...list("i18n", ".json")].filter((f) => !shell.has(f));
  assert.deepEqual(missing, []);
});

test("every file in the offline copy exists", () => {
  const gone = [...shell].filter((f) => f !== "/").filter((f) => {
    try { readFileSync(new URL(`..${f}`, import.meta.url)); return false; } catch { return true; }
  });
  assert.deepEqual(gone, []);
});

test("the code knows which deploy it came from: build.js matches sw.js", () => {
  const build = readFileSync(new URL("../js/build.js", import.meta.url), "utf8").match(/BUILD = "([^"]+)"/)[1];
  assert.equal(build, sw.match(/const CACHE_VERSION = "([^"]+)"/)[1], "bump both together");
});
