// voice-note.js — logging a meal by voice, as a voice note.
//
// Tapping Voice opens this screen already recording. People talk as long as they like (pauses
// included, up to MAX_SECONDS), then one button stops and sends. The recording is written down
// by the AI (api/gemini.js, mode "transcribe") and the words are logged exactly like a typed
// description (js/queue.js enqueueText), so the result screen shows what was heard.
//
// It replaced the old flow (open the Describe sheet, live speech recognition into a text box,
// then Analyze), which needed four taps and stopped whenever someone paused: the phone's own
// recognition gives up on silence and is refused outright in some installed apps.

import { chewHtml } from "./chew.js";
import * as queue from "../queue.js";
import { transcribeAudio } from "../api.js";
import { safeSrc } from "../safe-src.js";
import { openFullScreenCover } from "./sheet.js";
import { icon } from "./icons.js";
import { t, currentLanguage } from "../i18n.js";

export const MAX_SECONDS = 120;
const SPOKES = 60;          // dots around the ring, one per slice of recent sound
const RING_ROWS = 3;        // how far out a loud moment reaches
const MIN_BYTES = 1200;     // anything smaller is a tap, not a note

/** Whether this phone can record a voice note at all (otherwise the typed sheet is used). */
export function canRecordVoiceNote() {
  return typeof window !== "undefined" && !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
}

/** "0:07", "1:42" */
export function clock(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** How many dots of a spoke are lit for a level between 0 and 1 (the inner one always is). */
export function litDots(level) {
  const v = Math.max(0, Math.min(1, Number(level) || 0));
  return 1 + (v > 0.18 ? 1 : 0) + (v > 0.45 ? 1 : 0);
}

/**
 * @param {{timestamp?: number|null, onText?: (text:string, extra:{photoDataUrl:string|null, leftoversDataUrl:null})=>void, onType?: ()=>void}} opts
 *   onText: hand the words back (adding to a meal being edited) instead of logging a new meal;
 *   onType: open the typed sheet instead (mic refused, or they'd rather type)
 */
export function openVoiceNote({ timestamp = null, onText = null, onType = null } = {}) {
  let recorder = null;
  let stream = null;
  let audioCtx = null;
  let chunks = [];
  let blob = null;
  let startedAt = 0;
  let frame = 0;
  let tick = 0;
  let limit = 0;
  let photo = null;          // data URL of the optional meal photo
  let discarded = false;
  const levels = new Array(SPOKES).fill(0);

  const cover = openFullScreenCover({
    onClosed: () => teardown(),
    render(panel) {
      panel.classList.add("vn-cover");
      panel.innerHTML = `
        <div class="vn-screen">
          <div class="vn-top">
            <button type="button" class="vn-round" id="vn-close" aria-label="${t("voiceNote.discard")}">${icon("xmark", { size: 16 })}</button>
            <div class="vn-label">${t("voiceNote.title")}</div>
            <div class="vn-round-space"></div>
          </div>
          <div class="vn-ring" aria-hidden="true">
            <svg viewBox="0 0 268 268" id="vn-dots"></svg>
            <div class="vn-timer" id="vn-timer">0:00</div>
          </div>
          <div class="vn-prompt" id="vn-prompt" role="status" aria-live="polite">${t("voiceNote.prompt")}</div>
          <div class="vn-hint" id="vn-hint">${t("voiceNote.hint")}</div>
          <div class="vn-actions" id="vn-actions"></div>
          <div class="vn-under" id="vn-under">${t("voiceNote.under", { max: MAX_SECONDS / 60 })}</div>
        </div>`;
    },
  });
  const panel = cover.panelEl;
  const $ = (sel) => panel.querySelector(sel);

  // --- the dotted ring --------------------------------------------------------------------
  const svg = $("#vn-dots");
  const dots = [];
  for (let i = 0; i < SPOKES; i++) {
    const a = (i / SPOKES) * Math.PI * 2 - Math.PI / 2;
    const spoke = [];
    for (let k = 0; k < RING_ROWS; k++) {
      const r = 104 + k * 13;
      const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      c.setAttribute("cx", (134 + r * Math.cos(a)).toFixed(1));
      c.setAttribute("cy", (134 + r * Math.sin(a)).toFixed(1));
      c.setAttribute("r", k === 0 ? "3" : "2.6");
      c.setAttribute("class", "vn-dot");
      svg.appendChild(c);
      spoke.push(c);
    }
    dots.push(spoke);
  }
  const drawRing = () => {
    // the newest sound sits at the top and the older ones travel round clockwise
    for (let i = 0; i < SPOKES; i++) {
      const lit = litDots(levels[i]);
      dots[i].forEach((c, k) => c.classList.toggle("is-on", k < lit));
    }
  };

  // --- states -----------------------------------------------------------------------------
  const setActions = (html) => { $("#vn-actions").innerHTML = html; wireActions(); };
  const showRecording = () => {
    $("#vn-prompt").textContent = t("voiceNote.prompt");
    $("#vn-hint").textContent = t("voiceNote.hint");
    $("#vn-under").textContent = t("voiceNote.under", { max: MAX_SECONDS / 60 });
    setActions(`
      <button type="button" class="vn-side" id="vn-photo" aria-label="${t("voiceNote.photo")}">${photoButtonInner()}</button>
      <button type="button" class="vn-main" id="vn-stop" aria-label="${t("voiceNote.stop")}"><span class="vn-stop-square"></span></button>
      <div class="vn-side is-empty"></div>`);
  };
  const showSending = () => {
    panel.classList.add("is-sending");
    $("#vn-prompt").textContent = t("voiceNote.sending");
    $("#vn-hint").textContent = "";
    $("#vn-under").textContent = "";
    setActions(`<div class="vn-main is-busy" aria-hidden="true">${chewHtml(40)}</div>`);
  };
  const showError = (message, { retry = false, again = false } = {}) => {
    panel.classList.remove("is-sending");
    $("#vn-prompt").textContent = message;
    $("#vn-hint").textContent = "";
    $("#vn-under").textContent = "";
    setActions(`
      <div class="vn-choices">
        ${retry ? `<button type="button" class="vn-pill is-primary" id="vn-retry">${t("voiceNote.retry")}</button>` : ""}
        ${again ? `<button type="button" class="vn-pill is-primary" id="vn-again">${t("voiceNote.again")}</button>` : ""}
        <button type="button" class="vn-pill" id="vn-type">${t("voiceNote.type")}</button>
      </div>`);
  };
  const photoButtonInner = () => photo
    ? `<img class="vn-photo-thumb" src="${safeSrc(photo)}" alt="" />`
    : icon("cameraFill", { size: 20 });

  function wireActions() {
    $("#vn-stop")?.addEventListener("click", stopAndSend);
    // Boca0's own camera on top (the note keeps recording), with the gallery a tap away in it
    $("#vn-photo")?.addEventListener("click", async () => {
      const { openCameraScan } = await import("./scan.js");
      openCameraScan({ photoOnly: t("voiceNote.photo"), onResult: (r) => { if (r.dataUrl) { photo = r.dataUrl; refreshPhoto(); } } });
    });
    $("#vn-retry")?.addEventListener("click", () => send());
    $("#vn-again")?.addEventListener("click", () => { blob = null; startRecording(); });
    $("#vn-type")?.addEventListener("click", () => { discarded = true; cover.close(); onType?.(); });
  }

  $("#vn-close").addEventListener("click", () => { discarded = true; cover.close(); });
  const refreshPhoto = () => { const b = $("#vn-photo"); if (b) b.innerHTML = photoButtonInner(); };

  // --- recording --------------------------------------------------------------------------
  async function startRecording() {
    panel.classList.remove("is-sending");
    showRecording();
    chunks = [];
    levels.fill(0);
    drawRing();
    $("#vn-timer").textContent = "0:00";
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      showError(t("voiceNote.denied"));
      return;
    }
    if (discarded) { stopStream(); return; }
    // a compact codec the phone supports: Opus on Android, AAC on iPhone
    const types = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm", "audio/ogg"];
    const mimeType = types.find((type) => window.MediaRecorder.isTypeSupported?.(type));
    try {
      recorder = new MediaRecorder(stream, mimeType ? { mimeType, audioBitsPerSecond: 32000 } : undefined);
    } catch {
      stopStream();
      showError(t("voiceNote.failed"));
      return;
    }
    recorder.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
    recorder.onstop = () => {
      stopStream();
      if (discarded) return;
      blob = new Blob(chunks, { type: recorder.mimeType || mimeType || "audio/webm" });
      if (blob.size < MIN_BYTES) { showError(t("voiceNote.empty"), { again: true }); return; }
      send();
    };
    recorder.start(1000);
    startedAt = Date.now();
    listen(stream);
    tick = setInterval(() => { $("#vn-timer").textContent = clock((Date.now() - startedAt) / 1000); }, 250);
    limit = setTimeout(stopAndSend, MAX_SECONDS * 1000);
  }

  // the ring follows the voice: one new level about every 80ms, from the microphone's loudness
  function listen(s) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    try {
      audioCtx = new Ctx();
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      audioCtx.createMediaStreamSource(s).connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      let last = 0;
      const step = (now) => {
        frame = requestAnimationFrame(step);
        if (now - last < 80) return;
        last = now;
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (const v of data) sum += ((v - 128) / 128) ** 2;
        const rms = Math.sqrt(sum / data.length);
        levels.pop();
        levels.unshift(Math.min(1, rms * 5));
        drawRing();
      };
      frame = requestAnimationFrame(step);
    } catch { /* no meter: recording still works */ }
  }

  function stopAndSend() {
    clearTimeout(limit);
    clearInterval(tick);
    if (recorder && recorder.state !== "inactive") {
      showSending();
      recorder.stop(); // onstop sends
    }
  }

  function stopStream() {
    cancelAnimationFrame(frame);
    clearInterval(tick);
    clearTimeout(limit);
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    audioCtx?.close?.().catch(() => {});
    audioCtx = null;
  }

  // --- sending ----------------------------------------------------------------------------
  async function send() {
    if (!blob) return;
    showSending();
    const out = await transcribeAudio(blob, { lang: currentLanguage() === "es" ? "es" : "en" });
    if (discarded) return;
    if (!out.ok) {
      showError(out.errorType === "network" ? t("voiceNote.offline") : t("voiceNote.failed"), { retry: true });
      return;
    }
    const text = String(out.text ?? "").trim();
    if (!text) { showError(t("voiceNote.empty"), { again: true }); return; }
    const extra = { photoDataUrl: photo, leftoversDataUrl: null };
    if (onText) onText(text, extra);
    else queue.enqueueText(text, { ...(Number.isFinite(timestamp) ? { timestamp } : {}), photoDataUrl: photo });
    cover.close();
  }

  function teardown() {
    discarded = true;
    if (recorder && recorder.state !== "inactive") {
      try { recorder.stop(); } catch { /* already stopped */ }
    }
    stopStream();
  }

  startRecording();
  return cover;
}
