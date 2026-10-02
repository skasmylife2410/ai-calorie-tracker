// compat.test.mjs — the app must start on older phone browsers (Android 10 phones often keep an
// un-updated Chrome). Its code is ES2020 (optional chaining and ?? need Chrome 80); these later
// features crash Chrome 80–91, and one of them in any file breaks the whole app at start-up.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SKIP = ["js/ui/js", "js/ui/api", "js/ui/tests", "js/ui/supabase"];
function files(dir) {
  const out = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (SKIP.some((s) => p.startsWith(s))) continue;
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (p.endsWith(".js")) out.push(p);
  }
  return out;
}

const RULES = [
  [/\?\?=|\|\|=|&&=/, "logical assignment (Chrome 85)"],
  [/\b\d+_\d{3}\b/, "numeric separators (Chrome 75)"],
  [/\.at\(-?\d/, "Array.prototype.at (Chrome 92)"],
  [/\.replaceAll\(/, "String.prototype.replaceAll (Chrome 85)"],
  [/Object\.hasOwn\(|structuredClone\(|\.findLast\(|\.toSorted\(|Promise\.any\(/, "a Chrome 92+ built-in"],
];

test("client code avoids features that crash older Chrome", () => {
  const problems = [];
  for (const f of [...files("js"), "sw.js"]) {
    const lines = readFileSync(f, "utf8").split("\n");
    lines.forEach((line, i) => {
      if (/^\s*(\/\/|\*)/.test(line)) return; // comments
      for (const [re, what] of RULES) if (re.test(line)) problems.push(`${f}:${i + 1} ${what}`);
    });
  }
  assert.deepEqual(problems, []);
});

test("modules that import i18n's t under another name don't call a bare t()", () => {
  // app.js imports `t as translate`; a stray t("…") there broke the barcode lookup sheet.
  const problems = [];
  for (const f of [...files("js")]) {
    const src = readFileSync(f, "utf8");
    const definesT = /import\s*\{[^}]*(?:^|[{,\s])t\s*[,}][^]*?from|\b(?:const|let|var|function)\s+t\b/.test(src);
    if (definesT) continue;
    src.split("\n").forEach((line, i) => {
      if (/^\s*(\/\/|\*)/.test(line)) return;
      if (/(^|[^\w.$])t\(\s*["'`]/.test(line)) problems.push(`${f}:${i + 1}`);
    });
  }
  assert.deepEqual(problems, []);
});
