// _plate.js — what the plate drawing needs: the foods of a shared mealtime cleaned into plain words
// and weights, and the prompt for the image model. The call itself is api/doodle.js with
// { op: "plate", foods: [{ name, grams? }] } (the same billed image call and hourly allowance as
// the doodle, so a key without credits answers errorType "billing" and the phone keeps the board
// it draws itself, js/ui/ingredient-board.js). It lives there, not in a file of its own, because
// a Vercel Hobby deployment holds 12 serverless functions at most (tests/api-limit.test.mjs).

const MAX_FOODS = 8; // an illustration of more than this stops being readable

/** The foods as plain words and weights: letters, numbers and a little punctuation only, since
 *  the names are other people's text going into a prompt. */
export function cleanFoods(raw) {
  const seen = new Set();
  const out = [];
  for (const f of Array.isArray(raw) ? raw : []) {
    const name = String(f?.name ?? "").replace(/[^\p{L}\p{N} ,'’.%-]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 40);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push({ name, grams: Math.max(0, Math.min(2000, Math.round(Number(f?.grams) || 0))) });
    if (out.length >= MAX_FOODS) break;
  }
  return out;
}

export function buildPlatePrompt(foods) {
  const list = foods.map((f) => (f.grams > 0 ? `${f.name} (about ${f.grams} g)` : f.name)).join("; ");
  return [
    `Draw one illustration of these foods together on a table, seen from above, each food on its own small plate or bowl and clearly recognisable: ${list}.`,
    "Clean hand-drawn ink line art with soft flat colour on each food, like a calm editorial food illustration. Not a photo, not 3D.",
    "Plain pure white background. Landscape 4:3 composition, the foods arranged neatly with even spacing and generous white margins, nothing touching the edges, sized roughly in proportion to their weights.",
    "No text, no letters, no numbers, no people, no hands, no logos, no watermark, no frame.",
  ].join(" ");
}
