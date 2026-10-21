// api/doodle.js — draws each person's doodle with Nano Banana (Gemini's image model).
//
// POST { state, variant, photo? }  ->  { ok, image, mime }  |  { ok:false, errorType, message }
// POST { op: "plate", foods: [{ name, grams? }] }  -> the same: one illustration of a shared
//   mealtime's foods (see _plate.js)
//   state:   "strong" | "wellFed" | "idle" | "showoff"   — which pose ("showoff" is for shared summaries)
//   variant: "a" | "b"                        — him / her
//   photo:   optional base64 JPEG (no data: prefix) of the profile picture, so the doodle
//            looks like the person
//
// Models are tried cheapest first. Image generation is billed per image and Google doesn't
// offer it on the free API tier, so on a key without billing this returns errorType "billing"
// and the app keeps drawing its built-in doodle. The app caches every result on the phone, so
// each person costs about three images, once per profile photo.

import { requireUser } from "./_auth.js";
import { useAllowance, IMAGE_AI_PER_HOUR, overAllowance } from "./_limits.js";
import { generateImage, extractImage } from "./_image.js";
import { cleanFoods, buildPlatePrompt } from "./_plate.js";

export { extractImage }; // (kept here for the tests that import it from this file)

const MAX_PHOTO = 1_400_000; // base64 chars (~1 MB); the app sends a 512px crop

const POSES = {
  strong: "standing tall and proud, flexing one arm and holding a small dumbbell in the other hand, big confident smile",
  wellFed: "sitting back on a small couch looking happily full and a little sleepy, eyes half-closed, one hand resting on the tummy, content smile",
  showoff: "showing off after a great week: cool sunglasses, chest out, flexing both arms up high, a small medal on the chest, a few sparkle marks around, playful swagger",
  idle: "a little rounder than usual and slouching, looking bored and sluggish, holding a phone, mildly sheepish expression — gentle and funny, never mean",
};

export function buildDoodlePrompt({ state, variant, hasPhoto }) {
  const pose = POSES[state] ?? POSES.strong;
  const who = variant === "b" ? "a woman" : "a man";
  return [
    `Draw a single cute doodle character of ${who}: simple black ink line art, hand-drawn look, slightly wobbly lines, like a sketch in a notebook margin.`,
    "Big round head, simple rounded body, short limbs. Minimal detail, a few confident strokes.",
    hasPhoto
      ? "Base the face on the person in the photo — keep their hairstyle, hair length, facial hair, glasses or other stand-out features so friends would recognise them — but as a friendly cartoon, not a realistic portrait."
      : "Give them a friendly, simple face.",
    `Pose: ${pose}.`,
    "Plain pure white background. Full body, centred, with some white space around it. No text, no letters, no frame, no shadows, no colour except an optional single soft accent.",
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
  const plate = body.op === "plate" ? cleanFoods(body.foods) : null;
  if (plate && plate.length === 0) return res.status(200).json({ ok: false, errorType: "empty", message: "Nothing to draw." });
  if (!(await useAllowance(`img:${me}`, IMAGE_AI_PER_HOUR, 60))) return overAllowance(res);
  if (plate) return res.status(200).json(await generateImage(key, [{ text: buildPlatePrompt(plate) }]));
  const state = ["strong", "wellFed", "idle", "showoff"].includes(body.state) ? body.state : "strong";
  const variant = body.variant === "b" ? "b" : "a";
  const photo = typeof body.photo === "string" && body.photo.length > 0 && body.photo.length <= MAX_PHOTO ? body.photo : null;

  const parts = [];
  if (photo) parts.push({ inline_data: { mime_type: "image/jpeg", data: photo } });
  parts.push({ text: buildDoodlePrompt({ state, variant, hasPhoto: !!photo }) });

  return res.status(200).json(await generateImage(key, parts));
}
