// photo-inputs.test.mjs — buttons that ask for a photo of something open SnapCal's own camera.
// capture="environment" asked for the camera app directly, and on some Android phones that did
// nothing at all ("Photograph the leftovers" never opened anything); without it, Android offers
// only the gallery. The meal scanner's camera (getUserMedia) works on those phones, so these
// buttons use it, in its photo-only form, with the gallery a tap away inside it.
import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";

test("no photo input asks for the camera app directly", async () => {
  const dir = new URL("../js/ui/", import.meta.url);
  for (const name of await readdir(dir)) {
    if (!name.endsWith(".js")) continue;
    const src = await readFile(new URL(name, dir), "utf8");
    assert.ok(!/<input[^>]*type="file"[^>]*\bcapture=/.test(src), `${name} uses capture=`);
  }
});

test("leftovers, size check, label photo and the voice note's photo use the in-app camera", async () => {
  for (const name of ["leftovers-sheet.js", "size-check.js", "addfood.js", "voice-note.js"]) {
    const src = await readFile(new URL(`../js/ui/${name}`, import.meta.url), "utf8");
    assert.match(src, /openCameraScan\(\{ photoOnly:/, name);
    assert.ok(!/type="file"/.test(src), `${name} has no file input of its own`);
  }
  const scan = await readFile(new URL("../js/ui/scan.js", import.meta.url), "utf8");
  assert.match(scan, /photoOnly \? `<div class="scan-photo-title">/, "photo-only hides the Food / Barcode / Label switch");
});
