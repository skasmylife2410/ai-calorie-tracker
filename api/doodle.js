// api/doodle.js — draws each person's doodle with Nano Banana (Gemini's image model).
//
// POST { state, variant, photo? }  ->  { ok, image, mime }  |  { ok:false, errorType, message }
//   state:   "strong" | "wellFed" | "idle"   — which pose
//   variant: "a" | "b"                        — him / her
//   photo:   optional base64 JPEG (no data: prefix) of the profile picture, so the doodle
//            looks like the person
//
// Models are tried cheapest first. Image generation is billed per image and Google doesn't
// offer it on the free API tier, so on a key without billing this returns errorType "billing"
// and the app keeps drawing its built-in doodle. The app caches every result on the phone, so
// each person costs about three images, once per profile photo.

import { checkAuth } from "./_auth.js";

const MODELS = ["gemini-3.1-flash-lite-image", "gemini-2.5-flash-image"];
const MAX_PHOTO = 1_400_000; // base64 chars (~1 MB); the app sends a 512px crop

const POSES = {
  strong: "standing tall and proud, flexing one arm and holding a small dumbbell in the other hand, big confident smile",
  wellFed: "sitting back on a small couch looking happily full and a little sleepy, eyes half-closed, one hand resting on the tummy, content smile",
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

function classify(status, bodyText) {
  if (status === 429) return { errorType: "quota", message: "The image model is busy or over its limit. Try again later." };
  if (status === 403 || /billing|FAILED_PRECONDITION|free tier|not available/i.test(bodyText)) {
    return { errorType: "billing", message: "Nano Banana needs billing turned on for this Gemini key." };
  }
  if (status === 404) return { errorType: "model", message: "Image model not found." };
  if (status === 400 && /API key/i.test(bodyText)) return { errorType: "badKey", message: "The Gemini key was refused." };
  return { errorType: "other", message: `Image model error (${status}).` };
}

/** Pulls the first image out of a generateContent response, whichever casing the API uses. */
export function extractImage(json) {
  for (const cand of json?.candidates ?? []) {
    for (const part of cand?.content?.parts ?? []) {
      const d = part.inlineData ?? part.inline_data;
      if (d?.data) return { image: d.data, mime: d.mimeType ?? d.mime_type ?? "image/png" };
    }
  }
  return null;
}

async function tryModel(model, key, parts) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts }], generationConfig: { responseModalities: ["TEXT", "IMAGE"] } }),
    });
  } catch (err) {
    return { ok: false, errorType: "network", message: `Network error: ${err?.message ?? err}` };
  }
  const text = await res.text().catch(() => "");
  if (!res.ok) return { ok: false, ...classify(res.status, text) };
  let json;
  try { json = JSON.parse(text); } catch { return { ok: false, errorType: "parse", message: "Unreadable image response." }; }
  const img = extractImage(json);
  if (!img) return { ok: false, errorType: "noImage", message: "The model didn't return a picture." };
  return { ok: true, ...img, model };
}

export default async function handler(req, res) {
  const me = checkAuth(req, res);
  if (!me) return;
  if (req.method !== "POST") return res.status(405).json({ ok: false, errorType: "other", message: "Method not allowed" });

  const key = (process.env.GEMINI_API_KEY || "").trim();
  if (!key) return res.status(200).json({ ok: false, errorType: "badKey", message: "No Gemini key set." });

  const body = typeof req.body === "object" && req.body ? req.body : JSON.parse(req.body || "{}");
  const state = ["strong", "wellFed", "idle"].includes(body.state) ? body.state : "strong";
  const variant = body.variant === "b" ? "b" : "a";
  const photo = typeof body.photo === "string" && body.photo.length > 0 && body.photo.length <= MAX_PHOTO ? body.photo : null;

  const parts = [];
  if (photo) parts.push({ inline_data: { mime_type: "image/jpeg", data: photo } });
  parts.push({ text: buildDoodlePrompt({ state, variant, hasPhoto: !!photo }) });

  let last = null;
  for (const model of MODELS) {
    const out = await tryModel(model, key, parts);
    if (out.ok) return res.status(200).json(out);
    last = out;
    // a missing model or a transient failure is worth trying the next model for; a key or
    // billing problem will be the same on every model, so stop there
    if (["badKey", "billing", "quota"].includes(out.errorType)) break;
  }
  return res.status(200).json(last);
}
