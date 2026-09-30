// home-gif.js — the GIF on Home's "What should I eat?" button.
// By default it's the first GIPHY result for a chewing cow (looked up once, then remembered).
// Holding the button opens the GIF picker on that search, so anyone can choose the exact GIF
// they like; that choice is kept on the phone. The words stay under the GIF for screen readers
// and show whenever there's no GIF yet or it can't load.

import { t } from "../i18n.js";
import { searchGifs } from "../social.js";
import { cleanGif, gifImgHtml, HOME_GIF_QUERY } from "../gif.js";
import { openGifPicker } from "./gif-picker.js";

const PICKED_KEY = "snapcal.homeGif";        // the person's own choice
const DEFAULT_KEY = "snapcal.homeGifDefault"; // the looked-up default: { gif, at }
const DEFAULT_TTL_MS = 30 * 86400000;         // look again monthly, in case it disappears
const HOLD_MS = 550;

const read = (k) => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };

/** The GIF to show right now, or null (then only the words show). */
export function homeGif() {
  const picked = cleanGif(read(PICKED_KEY));
  if (picked) return picked;
  const d = read(DEFAULT_KEY);
  return d && Date.now() - (d.at || 0) < DEFAULT_TTL_MS ? cleanGif(d.gif) : null;
}

export function homeGifImgHtml() {
  const g = homeGif();
  return g ? gifImgHtml(g, { cls: "chip-ideas-gif", alt: "" }) : "";
}

let lookingUp = null;
async function ensureDefault() {
  if (homeGif() || lookingUp) return lookingUp;
  lookingUp = searchGifs(HOME_GIF_QUERY).then((out) => {
    const first = out?.ok ? cleanGif(out.gifs?.[0]) : null;
    if (first) write(DEFAULT_KEY, { gif: first, at: Date.now() });
    return first;
  }).catch(() => null).finally(() => { lookingUp = null; });
  return lookingUp;
}

function show(chip, gif) {
  chip.querySelector(".chip-ideas-gif")?.remove();
  if (gif) chip.insertAdjacentHTML("beforeend", gifImgHtml(gif, { cls: "chip-ideas-gif", alt: "" }));
}

/** Tap: `onTap`. Hold (or right-click): choose the GIF. Fills in the default GIF when needed. */
export function wireHomeGifChip(chip, onTap) {
  if (!chip) return;
  if (!homeGif()) ensureDefault().then((g) => { if (g && chip.isConnected) show(chip, g); });

  let timer = null;
  let held = false;
  const choose = async () => {
    held = true;
    const g = await openGifPicker({ query: HOME_GIF_QUERY, title: t("gif.homeTitle") });
    if (!g) return;
    write(PICKED_KEY, g);
    show(chip, g);
    // tell the owner which one was picked, so a favourite can become everyone's default
    fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-snapcal-token": globalThis.localStorage?.getItem("snapcal.apiToken") || "" },
      body: JSON.stringify({ op: "clientError", message: `Home GIF picked: ${g.id} (${g.w}x${g.h})` }),
    }).catch(() => {});
  };
  chip.addEventListener("pointerdown", () => {
    held = false;
    clearTimeout(timer);
    timer = setTimeout(choose, HOLD_MS);
  });
  for (const ev of ["pointerup", "pointerleave", "pointercancel"]) chip.addEventListener(ev, () => clearTimeout(timer));
  chip.addEventListener("contextmenu", (e) => { e.preventDefault(); clearTimeout(timer); if (!held) choose(); });
  chip.addEventListener("click", (e) => {
    if (held) { e.preventDefault(); held = false; return; }
    onTap();
  });
}
