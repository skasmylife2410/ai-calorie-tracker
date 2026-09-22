// voice.js — dictation for logging meals by voice.
//
// Two engines, picked automatically:
//  1. On-device speech recognition (Chrome/Android, Safari on iPhone): words appear live as you
//     talk, nothing is uploaded, and it's free.
//  2. Otherwise, record the voice note and have Gemini transcribe it (api/gemini.js, mode
//     "transcribe"). Words appear once you stop.
// Either way the result is plain text that lands in the Describe box, where it can be corrected
// before analysis.

import { transcribeAudio } from "../api.js";

const MAX_SECONDS = 60;

export function voiceSupport() {
  const hasRecognition = typeof window !== "undefined" && !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  const hasRecorder = typeof window !== "undefined" && !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
  return { hasRecognition, hasRecorder, any: hasRecognition || hasRecorder };
}

/**
 * Starts listening. Returns { stop } — call stop() to finish.
 * @param {{lang:"en"|"es", onText:(text:string, final:boolean)=>void, onState:(s:string)=>void, onError:(msg:string)=>void}} h
 */
export function startDictation({ lang = "en", onText, onState, onError }) {
  const locale = lang === "es" ? "es-CO" : "en-US";
  const { hasRecognition, hasRecorder } = voiceSupport();
  if (hasRecognition) return withRecognition(locale, { onText, onState, onError, fallback: hasRecorder ? () => withRecorder(lang, { onText, onState, onError }) : null });
  if (hasRecorder) return withRecorder(lang, { onText, onState, onError });
  onError("voice-unsupported");
  return { stop() {} };
}

function withRecognition(locale, { onText, onState, onError, fallback }) {
  const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
  const rec = new Rec();
  rec.lang = locale;
  rec.interimResults = true;
  rec.continuous = true;
  let finalText = "";
  let stopped = false;
  let switched = null;

  rec.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalText += r[0].transcript + " ";
      else interim += r[0].transcript;
    }
    onText((finalText + interim).trim(), false);
  };
  rec.onerror = (e) => {
    // Some installed-app contexts refuse on-device recognition; fall back to recording.
    if ((e.error === "not-allowed" || e.error === "service-not-allowed") && fallback && !stopped) {
      switched = fallback();
      return;
    }
    if (e.error === "no-speech") return; // silence isn't an error worth shouting about
    onError(e.error === "not-allowed" ? "voice-denied" : "voice-failed");
  };
  rec.onend = () => {
    if (switched) return;
    onState("idle");
    onText(finalText.trim(), true);
  };

  try {
    rec.start();
    onState("listening");
  } catch {
    if (fallback) switched = fallback();
    else onError("voice-failed");
  }
  const timer = setTimeout(() => api.stop(), MAX_SECONDS * 1000);
  const api = {
    stop() {
      stopped = true;
      clearTimeout(timer);
      if (switched) return switched.stop();
      try { rec.stop(); } catch { /* already stopped */ }
    },
  };
  return api;
}

function withRecorder(lang, { onText, onState, onError }) {
  let recorder = null;
  let stream = null;
  let chunks = [];
  let cancelled = false;

  const finish = async () => {
    stream?.getTracks().forEach((t) => t.stop());
    if (cancelled || chunks.length === 0) { onState("idle"); return; }
    onState("transcribing");
    const blob = new Blob(chunks, { type: recorder?.mimeType || "audio/webm" });
    const out = await transcribeAudio(blob, { lang });
    onState("idle");
    if (!out.ok) return onError(out.message || "voice-failed");
    if (!out.text) return onError("voice-empty");
    onText(out.text, true);
  };

  const timer = setTimeout(() => api.stop(), MAX_SECONDS * 1000);
  const api = {
    stop() {
      clearTimeout(timer);
      if (recorder && recorder.state !== "inactive") recorder.stop();
      else { cancelled = true; stream?.getTracks().forEach((t) => t.stop()); onState("idle"); }
    },
  };

  navigator.mediaDevices.getUserMedia({ audio: true })
    .then((s) => {
      stream = s;
      // prefer a compact codec the phone actually supports
      const types = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm", "audio/ogg"];
      const mimeType = types.find((t) => window.MediaRecorder.isTypeSupported?.(t));
      recorder = new MediaRecorder(stream, mimeType ? { mimeType, audioBitsPerSecond: 32000 } : undefined);
      recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      recorder.onstop = finish;
      recorder.start();
      onState("recording");
    })
    .catch(() => {
      clearTimeout(timer);
      onError("voice-denied");
      onState("idle");
    });

  return api;
}
