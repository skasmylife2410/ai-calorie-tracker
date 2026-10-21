// _image.js — the image model (Nano Banana, Gemini's image generation) shared by the doodle and the
// plate drawing: which models to try, how a refusal is told apart, and getting the picture out.
//
// Models are tried cheapest first. Image generation is billed per image (Google doesn't offer it
// on the free API tier), so a key without billing or credits answers errorType "billing"; callers
// then keep what they draw themselves.

export const MODELS = ["gemini-3.1-flash-lite-image", "gemini-2.5-flash-image"];

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

/** Draws with the first model that answers; stops early on a key, billing or quota problem. */
export async function generateImage(key, parts) {
  let last = null;
  for (const model of MODELS) {
    const out = await tryModel(model, key, parts);
    if (out.ok) return out;
    last = out;
    // a missing model or a transient failure is worth trying the next model for; a key or
    // billing problem will be the same on every model, so stop there
    if (["badKey", "billing", "quota"].includes(out.errorType)) break;
  }
  return last;
}
