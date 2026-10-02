// crop.test.mjs — what's kept when a photo is cropped.
import test from "node:test";
import assert from "node:assert/strict";
import { cropRect, clampOffset } from "../js/ui/crop.js";

test("the framed part of the image, in image pixels", () => {
  // 1000x500 photo shown at half size in a 250x250 square frame, moved 100px left
  assert.deepEqual(cropRect({ imgW: 1000, imgH: 500, frameW: 250, frameH: 250, scale: 0.5, offX: -100, offY: 0 }), { x: 200, y: 0, w: 500, h: 500 });
});

test("the image always covers the frame", () => {
  const o = clampOffset({ imgW: 1000, imgH: 500, frameW: 250, frameH: 250, scale: 0.5, offX: 80, offY: -40 });
  assert.deepEqual(o, { offX: 0, offY: 0 });
  const far = clampOffset({ imgW: 1000, imgH: 500, frameW: 250, frameH: 250, scale: 0.5, offX: -900, offY: 0 });
  assert.equal(far.offX, -250, "can't slide past the right edge");
});
