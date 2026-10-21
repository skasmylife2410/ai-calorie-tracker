// api/plate.js — draws the foods of a shared mealtime as one illustration, with Nano Banana
// (Gemini's image model), for a mealtime that has no photos to make a collage from.
//
// POST { foods: [{ name, grams? }] }  ->  { ok, image, mime }  |  { ok:false, errorType, message }
//
// The same billed image call as the doodle (api/_image.js) and the same hourly allowance
// (IMAGE_AI_PER_HOUR), so a key without credits answers errorType "billing" and the phone keeps
// the board it draws itself (js/ui/ingredient-board.js). The phone keeps what comes back for the
// share it's for; nothing is stored here.

import { requireUser } from "./_auth.js";
import { useAllowance, IMAGE_AI_PER_HOUR, overAllowance } from "./_limits.js";
import { generateImage } from "./_image.js";

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

export default async function handler(req, res) {
  const me = await requireUser(req, res);
  if (!me) return;
  if (req.method !== "POST") return res.status(405).json({ ok: false, errorType: "other", message: "Method not allowed" });

  const key = (process.env.GEMINI_API_KEY || "").trim();
  if (!key) return res.status(200).json({ ok: false, errorType: "badKey", message: "No Gemini key set." });

  let body;
  try { body = typeof req.body === "object" && req.body ? req.body : JSON.parse(req.body || "{}"); } catch { body = {}; }
  const foods = cleanFoods(body.foods);
  if (foods.length === 0) return res.status(200).json({ ok: false, errorType: "empty", message: "Nothing to draw." });
  if (!(await useAllowance(`img:${me}`, IMAGE_AI_PER_HOUR, 60))) return overAllowance(res);

  return res.status(200).json(await generateImage(key, [{ text: buildPlatePrompt(foods) }]));
}
