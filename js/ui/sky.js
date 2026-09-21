// sky.js — "the day fills up": a soft, glowing band of colour rises from the bottom of the screen
// as the day passes, like a very slow progress bar. No numbers: how high the light has climbed
// is how much of the day has gone. The colour of the light also shifts through the day.
//
// Fixed hours: the day runs 6:00 → 23:00. Overnight the light sinks back to a low indigo glow,
// so each morning starts from the bottom again.
//
// Fixed hours, the same on every phone (no location needed). Colours blend continuously
// between the moments below, so 4:30 pm sits between afternoon gold and sunset orange rather
// than jumping. The base stays light at every hour so text and cards never lose contrast —
// night is deeper colour, not a dark mode.

// hour -> three glow colours (bottom-left, bottom-right, top) + the base behind them
const MOMENTS = [
  { h: 0,    glow: ["#4C4FB8", "#7B4FC9", "#2A8FA8"], base: "#EEEFF6" }, // night
  { h: 5,    glow: ["#6C63D9", "#E58FB2", "#F3B48C"], base: "#F3EFF4" }, // dawn
  { h: 8,    glow: ["#79B6F2", "#B7A2F2", "#FFD2A6"], base: "#F6F5F3" }, // morning
  { h: 12,   glow: ["#58A6F5", "#6FD3E3", "#BBA8FF"], base: "#F5F7F8" }, // midday
  { h: 16,   glow: ["#F6B15E", "#F2855E", "#C0A3F2"], base: "#F8F4EF" }, // afternoon
  { h: 18.5, glow: ["#EE5B50", "#F59A5C", "#A35CE0"], base: "#F8EFEC" }, // sunset
  { h: 21,   glow: ["#4C4FB8", "#7B4FC9", "#2A8FA8"], base: "#EEEFF6" }, // night
  { h: 24,   glow: ["#4C4FB8", "#7B4FC9", "#2A8FA8"], base: "#EEEFF6" }, // wraps to midnight
];

const hexToRgb = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const mix = (a, b, t) => hexToRgb(a).map((v, i) => Math.round(v + (hexToRgb(b)[i] - v) * t));
const rgb = ([r, g, b], alpha = 1) => `rgba(${r},${g},${b},${alpha})`;

/** Colours for a given moment, blended between the two surrounding keyframes. */
export function skyAt(date = new Date()) {
  const hour = date.getHours() + date.getMinutes() / 60;
  let i = 0;
  while (i < MOMENTS.length - 1 && MOMENTS[i + 1].h <= hour) i++;
  const a = MOMENTS[i], b = MOMENTS[Math.min(i + 1, MOMENTS.length - 1)];
  const span = b.h - a.h || 1;
  // ease so the change lingers on each moment and moves faster between them
  const raw = Math.min(1, Math.max(0, (hour - a.h) / span));
  const t = raw * raw * (3 - 2 * raw);
  return {
    glow: a.glow.map((c, k) => mix(c, b.glow[k], t)),
    base: mix(a.base, b.base, t),
  };
}

const DAY_START = 6;
const DAY_END = 23;

/**
 * Share of the waking day that has passed, 0 → 1. Null overnight (23:00–6:00).
 */
export function dayProgress(date = new Date()) {
  const hour = date.getHours() + date.getMinutes() / 60;
  if (hour < DAY_START || hour >= DAY_END) return null;
  // linear on purpose: every hour of the day moves the light the same distance
  return (hour - DAY_START) / (DAY_END - DAY_START);
}

/** Test/preview hook: ?sky=19.5 forces a time of day. */
function overrideDate() {
  const q = new URLSearchParams(location.search).get("sky");
  if (q === null || q === "") return null;
  const h = Number(q);
  if (!Number.isFinite(h)) return null;
  const d = new Date();
  d.setHours(Math.floor(h), Math.round((h % 1) * 60), 0, 0);
  return d;
}

export function mountSky(root = document.body) {
  if (document.getElementById("sky")) return;
  const sky = document.createElement("div");
  sky.id = "sky";
  // Start already in place: the 60s transition is for the slow climb during the day, not for
  // sliding up from nowhere every time the app opens.
  sky.className = "sky-settling";
  sky.setAttribute("aria-hidden", "true");
  sky.innerHTML = `
    <div class="sky-fill">
      <i class="sky-blob b1"></i><i class="sky-blob b2"></i>
      <i class="sky-crest"></i>
    </div>
    <i class="sky-veil"></i>`;
  root.prepend(sky);

  const paint = () => {
    const now = overrideDate() ?? new Date();
    const { glow, base } = skyAt(now);
    // How far the light has climbed: 12% of the screen at 6 am, 92% by 11 pm, a low 9% glow overnight.
    const p = dayProgress(now);
    const height = p === null ? 9 : 12 + p * 80;
    document.documentElement.style.setProperty("--sky-level", `${height.toFixed(2)}vh`);
    const s = document.documentElement.style;
    s.setProperty("--sky-base", rgb(base));
    s.setProperty("--sky-1", rgb(glow[0], 0.78));
    s.setProperty("--sky-2", rgb(glow[1], 0.70));
    s.setProperty("--sky-3", rgb(glow[2], 0.46));
    // solid versions for the bright edge band along the bottom
    s.setProperty("--sky-e1", rgb(glow[0], 0.95));
    s.setProperty("--sky-e2", rgb(glow[1], 0.95));
    s.setProperty("--sky-e3", rgb(glow[2], 0.95));
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", rgb(base));
  };
  paint();
  requestAnimationFrame(() => requestAnimationFrame(() => sky.classList.remove("sky-settling")));
  setInterval(paint, 60 * 1000); // a minute is plenty; the change is slow by design
  document.addEventListener("visibilitychange", () => { if (!document.hidden) paint(); });
}
