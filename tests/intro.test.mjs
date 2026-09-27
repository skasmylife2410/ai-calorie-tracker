import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shouldPlay, INTRO_HASH } from "../js/intro.js";

const store = (v) => ({ getItem: () => v });

test("intro plays on a normal start, not after a silent auto-update", () => {
  assert.equal(shouldPlay(store(null)), true);
  assert.equal(shouldPlay(store("1")), false);
  assert.equal(shouldPlay({ getItem() { throw new Error("private"); } }), true);
});

test("intro design is a Fluid share hash and the engine is served from our own origin", () => {
  assert.match(INTRO_HASH, /^#p=[-\d.,]+$/);
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.ok(html.indexOf('src="/js/intro.js"') < html.indexOf('src="/js/app.js"'), "intro runs before the app");
  assert.match(readFileSync(new URL("../js/intro.js", import.meta.url), "utf8"), /import\("\/vendor\/fluid-bg\/core\.js"\)/);
  assert.doesNotMatch(readFileSync(new URL("../vendor/fluid-bg/core.js", import.meta.url), "utf8"), /sourceMappingURL/);
});
