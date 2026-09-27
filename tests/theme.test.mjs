import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveTheme, DEFAULT_THEME, THEMES } from "../js/theme.js";

test("everyone gets Mono Light unless they chose otherwise", () => {
  assert.equal(DEFAULT_THEME, "mono-light");
  assert.deepEqual(resolveTheme({}), { theme: "mono", mode: "light", markers: true });
  assert.deepEqual(resolveTheme({ theme: "something-old" }), { theme: "mono", mode: "light", markers: true });
});

test("Classic, Mono Dark and Mono Auto resolve as picked", () => {
  assert.deepEqual(resolveTheme({ theme: "classic" }), { theme: "classic", mode: null, markers: true });
  assert.equal(resolveTheme({ theme: "mono-dark" }).mode, "dark");
  assert.equal(resolveTheme({ theme: "mono-auto" }, false).mode, "light");
  assert.equal(resolveTheme({ theme: "mono-auto" }, true).mode, "dark");
  assert.equal(resolveTheme({ theme: "mono-light" }, true).mode, "light", "an explicit choice ignores the phone");
});

test("coloured markers can be switched off, only in Mono", () => {
  assert.equal(resolveTheme({ monoMarkers: false }).markers, false);
  assert.equal(resolveTheme({ theme: "classic", monoMarkers: false }).markers, true);
});

test("the pre-paint boot script knows the same themes and default", () => {
  const boot = readFileSync(new URL("../js/theme-boot.js", import.meta.url), "utf8");
  for (const id of THEMES) assert.ok(boot.includes(`"${id}"`), `theme-boot.js lists ${id}`);
  assert.match(boot, /: "mono-light";/);
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.ok(html.indexOf('src="/js/theme-boot.js"') < html.indexOf("/css/theme.css"), "boot runs before any stylesheet paints");
  assert.ok(html.indexOf("/css/mono.css") > html.indexOf("/css/app.css"), "mono.css overrides app.css");
});

test("Mono's light marker colours keep at least 3:1 contrast on white and on the page grey", () => {
  const css = readFileSync(new URL("../css/mono.css", import.meta.url), "utf8");
  const light = css.slice(css.indexOf(':root[data-theme="mono"] {'), css.indexOf(':root[data-theme="mono"][data-mode="dark"] {'));
  const lum = (hex) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
  for (const name of ["protein", "carbs", "fat", "water", "flame", "over", "good", "violet"]) {
    const hex = light.match(new RegExp(`--mn-${name}: (#[0-9A-Fa-f]{6})`))?.[1];
    assert.ok(hex, `--mn-${name} is defined for light`);
    assert.ok(ratio(hex, "#FFFFFF") >= 3, `${name} ${hex} on white`);
    assert.ok(ratio(hex, "#F2F2F2") >= 3, `${name} ${hex} on #F2F2F2`);
  }
  const sec = light.match(/--mn-sec: (#[0-9A-Fa-f]{6})/)[1];
  assert.ok(ratio(sec, "#FFFFFF") >= 4.5, "secondary text meets AA on white");
});

test("Mono Dark: every surface keeps ink, secondary text and markers readable", () => {
  const css = readFileSync(new URL("../css/mono.css", import.meta.url), "utf8");
  const start = css.indexOf(':root[data-theme="mono"][data-mode="dark"] {');
  const dark = css.slice(start, css.indexOf("}", start));
  const hex = (name) => dark.match(new RegExp(`--mn-${name}: (#[0-9A-Fa-f]{6})`))?.[1];
  const lum = (h) => {
    const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
  const surfaces = ["bg", "card", "raised", "control"].map(hex);
  assert.ok(surfaces.every(Boolean), "dark defines page, card, raised and control");
  for (let i = 1; i < surfaces.length; i++) assert.ok(lum(surfaces[i]) > lum(surfaces[i - 1]), "each surface is lighter than the one beneath it");
  for (const s of surfaces) {
    assert.ok(ratio(hex("ink"), s) >= 7, `ink on ${s}`);
    assert.ok(ratio(hex("sec"), s) >= 4.5, `secondary text on ${s}`);
    for (const m of ["protein", "carbs", "fat", "water", "flame", "over", "good", "violet"]) assert.ok(ratio(hex(m), s) >= 3, `${m} on ${s}`);
  }
});
