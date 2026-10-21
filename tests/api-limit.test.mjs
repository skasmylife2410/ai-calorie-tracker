// api-limit.test.mjs — a Vercel Hobby deployment holds at most 12 serverless functions: every .js in
// api/ whose name doesn't start with "_". A thirteenth made v103's build fail and kept the site on
// the version before it. New server work goes into an existing function (as an `op`) or a helper.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";

test("api/ stays within 12 serverless functions", () => {
  const functions = readdirSync(new URL("../api/", import.meta.url)).filter((f) => f.endsWith(".js") && !f.startsWith("_"));
  assert.ok(functions.length <= 12, `${functions.length} functions: ${functions.join(", ")}`);
});
