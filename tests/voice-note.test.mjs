// voice-note.test.mjs — the voice-note screen's pieces that don't need a microphone, and that
// the Voice button reaches it.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

class MemoryStorage {
  constructor() { this._d = new Map(); }
  getItem(k) { return this._d.has(k) ? this._d.get(k) : null; }
  setItem(k, v) { this._d.set(k, String(v)); }
  removeItem(k) { this._d.delete(k); }
  clear() { this._d.clear(); }
}
globalThis.localStorage = new MemoryStorage();

const { clock, litDots, MAX_SECONDS, canRecordVoiceNote } = await import("../js/ui/voice-note.js");

test("the timer reads minutes and seconds", () => {
  assert.equal(clock(0), "0:00");
  assert.equal(clock(7.9), "0:07");
  assert.equal(clock(102), "1:42");
  assert.equal(clock(-3), "0:00");
});

test("the ring lights one dot for silence and three for a loud moment", () => {
  assert.equal(litDots(0), 1);
  assert.equal(litDots(0.3), 2);
  assert.equal(litDots(0.9), 3);
  assert.equal(litDots(7), 3, "clamped");
  assert.equal(litDots("x"), 1);
});

test("a note is up to two minutes, which the server accepts", async () => {
  assert.equal(MAX_SECONDS, 120);
  // at the 32 kbps the recorder asks for, two minutes is ~640 KB of base64, under the server's cap
  const gemini = await readFile(new URL("../api/gemini.js", import.meta.url), "utf8");
  const cap = Number(gemini.match(/MAX_AUDIO_BASE64 = ([\d_]+)/)[1].replace(/_/g, ""));
  assert.ok((MAX_SECONDS * 32000 / 8) * 4 / 3 < cap);
});

test("without a recorder (no microphone API) it says so, and the typed sheet is used", () => {
  assert.equal(canRecordVoiceNote(), false);
});

test("the Voice button and the add-to-meal Voice option open the voice note", async () => {
  const app = await readFile(new URL("../js/app.js", import.meta.url), "utf8");
  assert.match(app, /case "voice": \{[\s\S]*?openVoiceNote\(/);
  const add = await readFile(new URL("../js/ui/add-to-meal.js", import.meta.url), "utf8");
  assert.match(add, /openVoiceNote\(\{ onText/);
  const sw = await readFile(new URL("../sw.js", import.meta.url), "utf8");
  assert.ok(sw.includes('"/js/ui/voice-note.js"'), "cached for offline start");
});

test("every voice-note string exists in English and Spanish", async () => {
  const src = await readFile(new URL("../js/ui/voice-note.js", import.meta.url), "utf8");
  const keys = [...new Set([...src.matchAll(/t\("voiceNote\.(\w+)"/g)].map((m) => m[1]))];
  for (const lang of ["en", "es"]) {
    const dict = JSON.parse(await readFile(new URL(`../i18n/${lang}.json`, import.meta.url), "utf8"));
    for (const k of keys) assert.ok(dict.voiceNote?.[k], `${lang}: voiceNote.${k}`);
  }
});
