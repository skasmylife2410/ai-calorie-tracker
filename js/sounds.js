// sounds.js — SnapCal's sounds, synthesized live with Web Audio (no audio files to download or cache).
// Two packs that follow the theme: Mono gets "Grid" (bit-crushed square blips and glitch noise, a
// data-terminal feel) and Classic gets "Neon" (detuned synthwave saws with an echo). Quiet by
// design, and the iPhone silent switch mutes them (audio session "ambient", which also never
// pauses the person's music).

const VOLUME = 0.22;
let ctx = null;
let master = null;
let echoIn = null;

function audio() {
  if (!ctx) {
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return null;
    try { if (globalThis.navigator?.audioSession) globalThis.navigator.audioSession.type = "ambient"; } catch { /* older Safari */ }
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = VOLUME;
    master.connect(ctx.destination);
    // one shared echo, so arpeggios and plucks get a tail
    const delay = ctx.createDelay(1);
    delay.delayTime.value = 0.11;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.32;
    const wet = ctx.createGain();
    wet.gain.value = 0.35;
    delay.connect(feedback).connect(delay);
    delay.connect(wet).connect(master);
    echoIn = delay;
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

/** Amplitude quantizer: fewer bits = grittier. */
const crushCurves = new Map();
function crusher(bits) {
  const ws = ctx.createWaveShaper();
  if (!crushCurves.has(bits)) {
    const n = 2048;
    const steps = 2 ** bits / 2;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.round(x * steps) / steps;
    }
    crushCurves.set(bits, curve);
  }
  ws.curve = crushCurves.get(bits);
  return ws;
}

/** Envelope on a gain node: fast attack, exponential decay to silence. */
function envelope(g, t, peak, attack, dur) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
}

/**
 * One oscillator voice. `to` glides the pitch, `cut`/`cutTo` sweep a lowpass, `bits` crushes it,
 * `detune` adds a second voice a few cents away (the synthwave shimmer), `echo` sends to the delay.
 */
function tone({ type = "square", freq, to, at = 0, dur = 0.08, gain = 0.5, attack = 0.003, cut, cutTo, q = 1, bits, detune, echo = false }) {
  const t = ctx.currentTime + at;
  const g = ctx.createGain();
  envelope(g, t, gain, attack, dur);
  let head = g;
  if (cut) {
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.Q.value = q;
    f.frequency.setValueAtTime(cut, t);
    if (cutTo) f.frequency.exponentialRampToValueAtTime(cutTo, t + dur);
    f.connect(head);
    head = f;
  }
  if (bits) {
    const c = crusher(bits);
    c.connect(head);
    head = c;
  }
  g.connect(master);
  if (echo) g.connect(echoIn);
  for (const cents of detune ? [-detune, detune] : [0]) {
    const o = ctx.createOscillator();
    o.type = type;
    o.detune.value = cents;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    o.connect(head);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
}

let noiseBuffer = null;
function noise({ at = 0, dur = 0.03, gain = 0.4, type = "highpass", freq = 3000, freqTo, q = 0.8, rise = false }) {
  if (!noiseBuffer) {
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuffer.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t = ctx.currentTime + at;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.Q.value = q;
  f.frequency.setValueAtTime(freq, t);
  if (freqTo) f.frequency.exponentialRampToValueAtTime(freqTo, t + dur);
  const g = ctx.createGain();
  if (rise) { // swells in and cuts off, like audio played backwards
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + dur);
    g.gain.setValueAtTime(0.0001, t + dur + 0.005);
  } else {
    envelope(g, t, gain, 0.002, dur);
  }
  src.connect(f).connect(g).connect(master);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.02);
}

// --- The two packs. Each sound is a tiny score. ---------------------------------------------

const GRID = {
  // meal logged / analysis done: a crisp click, two blips up a fifth, a high ping
  log() {
    noise({ dur: 0.008, gain: 0.5, type: "bandpass", freq: 4200, q: 2 });
    tone({ freq: 880, dur: 0.045, gain: 0.32, bits: 4 });
    tone({ freq: 1318.5, at: 0.055, dur: 0.07, gain: 0.32, bits: 4 });
    tone({ type: "sine", freq: 2637, at: 0.06, dur: 0.22, gain: 0.12, echo: true });
  },
  // one digit of the calorie count rolling by
  tick(over = false) {
    tone({ freq: over ? 520 : 1600, dur: 0.014, gain: over ? 0.22 : 0.16, bits: 3, cut: over ? 1400 : 5000 });
  },
  // the number passes zero: a crushed descending growl with a glitch stutter
  over() {
    [0, 0.05, 0.1].forEach((at) => noise({ at, dur: 0.018, gain: 0.35, type: "bandpass", freq: 1800, q: 3 }));
    tone({ type: "sawtooth", freq: 110, to: 52, at: 0.03, dur: 0.5, gain: 0.45, cut: 1600, cutTo: 160, q: 9, bits: 3 });
    tone({ type: "sine", freq: 55, at: 0.03, dur: 0.45, gain: 0.5 });
  },
  // meal restored: a rewind sweep that snaps off
  undo() {
    noise({ dur: 0.16, gain: 0.3, type: "bandpass", freq: 600, freqTo: 5000, q: 2, rise: true });
    tone({ type: "sawtooth", freq: 180, to: 1500, dur: 0.17, gain: 0.25, cut: 900, cutTo: 6000, q: 6, bits: 4 });
  },
  // streak up: a four-note bit arpeggio into the echo
  streak() {
    [1046.5, 1318.5, 1568, 2093].forEach((f, i) => tone({ freq: f, at: i * 0.055, dur: 0.06, gain: 0.26, bits: 4, echo: true }));
    tone({ type: "sine", freq: 4186, at: 0.24, dur: 0.35, gain: 0.06, echo: true });
  },
  // camera shutter: a hard noise snap over a sub thump
  shutter() {
    noise({ dur: 0.035, gain: 0.6, freq: 2500 });
    tone({ type: "sine", freq: 95, to: 40, dur: 0.1, gain: 0.55 });
    noise({ at: 0.06, dur: 0.012, gain: 0.35, type: "bandpass", freq: 6000, q: 2 });
  },
  // barcode found: a scanner chirp
  scan() {
    tone({ freq: 2200, dur: 0.06, gain: 0.24, bits: 4 });
    tone({ freq: 3300, at: 0.07, dur: 0.08, gain: 0.22, bits: 4 });
  },
};

const NEON = {
  log() {
    tone({ type: "sawtooth", freq: 523.25, dur: 0.3, gain: 0.22, cut: 3200, cutTo: 500, q: 4, detune: 9, echo: true });
    tone({ type: "sawtooth", freq: 783.99, at: 0.07, dur: 0.34, gain: 0.2, cut: 3600, cutTo: 520, q: 4, detune: 9, echo: true });
  },
  tick(over = false) {
    tone({ type: "triangle", freq: over ? 440 : 1240, dur: 0.02, gain: 0.2 });
  },
  over() {
    tone({ type: "sawtooth", freq: 220, to: 104, dur: 0.6, gain: 0.3, cut: 1300, cutTo: 260, q: 6, detune: 14 });
    tone({ type: "sine", freq: 55, dur: 0.5, gain: 0.4 });
  },
  undo() {
    tone({ type: "triangle", freq: 300, to: 1250, dur: 0.18, gain: 0.32, echo: true });
    noise({ dur: 0.15, gain: 0.12, type: "lowpass", freq: 900, freqTo: 7000, rise: true });
  },
  streak() {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
      tone({ type: "sawtooth", freq: f, at: i * 0.075, dur: 0.22, gain: 0.18, cut: 3800, cutTo: 700, q: 5, detune: 10, echo: true })
    );
  },
  shutter() {
    noise({ dur: 0.045, gain: 0.45, type: "lowpass", freq: 6500 });
    tone({ type: "triangle", freq: 150, to: 60, dur: 0.1, gain: 0.45 });
  },
  scan() {
    tone({ type: "sine", freq: 1760, dur: 0.07, gain: 0.3 });
    tone({ type: "sine", freq: 2637, at: 0.08, dur: 0.12, gain: 0.26, echo: true });
  },
};

export const PACKS = Object.freeze({ mono: GRID, classic: NEON });
export const SOUND_NAMES = Object.freeze(Object.keys(GRID));

/** Plays one sound from the pack for `theme` ("mono" | "classic"). Never throws. */
export function playSound(name, { theme = "mono", arg } = {}) {
  try {
    if (!audio()) return;
    const pack = PACKS[theme] ?? GRID;
    pack[name]?.(arg);
  } catch { /* sound is a nicety; never break the app */ }
}

/** Sets the overall loudness (0–1 of the built-in quiet level). */
export function setVolume(v) {
  if (!audio()) return;
  master.gain.value = VOLUME * Math.max(0, Math.min(1, Number(v)));
}
