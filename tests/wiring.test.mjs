// wiring.test.mjs — every module the app loads must actually provide what it's asked for.
//
// A missing import or a renamed export doesn't show up in logic tests: the logic still passes,
// but in the browser the module fails to load and the screen goes blank or a button throws.
// That has happened twice on this project. This test reads every import statement under js/
// and api/ and checks the named things exist as exports of the file they point at.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full);
    else if (/\.(m?js)$/.test(name)) files.push(full);
  }
};
walk(join(root, "js"));
walk(join(root, "api"));

function exportsOf(file) {
  const src = readFileSync(file, "utf8");
  const names = new Set();
  for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  for (const m of src.matchAll(/export\s*\{([^}]+)\}/g)) {
    for (const part of m[1].split(",")) {
      const alias = part.trim().split(/\s+as\s+/).pop().trim();
      if (alias) names.add(alias);
    }
  }
  if (/export\s+default\b/.test(src)) names.add("default");
  return names;
}

test("every import points at a real file and every named import is really exported", () => {
  const problems = [];
  let checked = 0;
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    // static imports only: import { a, b as c } from "./x.js"  /  import d from "./x.js"
    for (const m of src.matchAll(/^import\s+([^;]+?)\s+from\s+["'](\.[^"']+)["']/gm)) {
      const [, clause, spec] = m;
      const target = resolve(dirname(file), spec);
      const rel = file.replace(root + "/", "");
      if (!existsSync(target)) { problems.push(`${rel}: "${spec}" does not exist`); continue; }
      const available = exportsOf(target);
      const named = clause.match(/\{([^}]*)\}/);
      if (named) {
        for (const part of named[1].split(",")) {
          const name = part.trim().split(/\s+as\s+/)[0].trim();
          if (!name) continue;
          checked++;
          if (!available.has(name)) problems.push(`${rel}: imports "${name}" from ${spec}, which doesn't export it`);
        }
      }
      const def = clause.replace(/\{[^}]*\}/, "").replace(/\*\s+as\s+\w+/, "").replace(/,/g, "").trim();
      if (def) { checked++; if (!available.has("default")) problems.push(`${rel}: default import from ${spec}, which has no default export`); }
    }
  }
  assert.ok(checked > 100, `expected to check the app's imports, checked ${checked}`);
  assert.deepEqual(problems, []);
});

test("identifiers used in a UI module but never imported or defined are caught for known shared helpers", () => {
  // The two blank-screen bugs so far were a helper called in a file that never imported it.
  // For the helpers most often shared across screens, check each file that calls one imports
  // it or defines it.
  const helpers = ["plateSvg", "handReference", "handLabel", "openResultsSheet", "openAddFoodSheet", "mountEntryRow", "doodleSvg", "t", "formatDate", "formatNumber", "currentLanguage"];
  const problems = [];
  for (const file of files.filter((f) => f.includes("/js/"))) {
    const src = readFileSync(file, "utf8");
    const code = src.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const h of helpers) {
      const called = new RegExp(`(?<![\\w$.])${h}\\(`).test(code);
      if (!called) continue;
      const imported = new RegExp(`import\\s*\\{[^}]*\\b${h}\\b[^}]*\\}`).test(code);
      const defined = new RegExp(`(function\\s+${h}\\b|(const|let|var)\\s+${h}\\s*=|\\b${h}\\s*[,)]\\s*=>|\\(\\s*${h}\\s*[,)])`).test(code)
        || new RegExp(`[({,]\\s*${h}\\s*[,})]`).test(code.split("\n").filter((l) => /=>|function/.test(l)).join("\n"));
      if (!imported && !defined) problems.push(`${file.replace(root + "/", "")}: calls ${h}() without importing it`);
    }
  }
  assert.deepEqual(problems, []);
});
