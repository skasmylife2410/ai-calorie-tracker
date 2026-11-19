// photo-inputs.test.mjs — photo buttons open the phone's normal picker (camera or photos).
// capture="environment" asked for the camera app directly, and on some Android phones that did
// nothing at all: "Photograph the leftovers" never opened anything. The pickers without it
// (Describe's photo slots) worked on the same phones.
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
