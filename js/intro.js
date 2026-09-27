// intro.js — the opening: a slow pearl flow (the app's paper tones) with the SnapCal wordmark,
// then it dissolves into the app.
//
// The paper cover and wordmark are plain markup in index.html, so they're on screen before any
// script runs; this module only adds the moving picture and decides when to leave. It never
// holds the app back: the app boots underneath the whole time, and the intro leaves once both
// a short minimum has passed and the app has drawn something (or a hard cap, whichever first).
// The picture is drawn by fluid-bg (MIT, vendor/fluid-bg) from the design made in the Fluid
// studio; phones without WebGL simply keep the plain paper cover.

export const INTRO_HASH = "#p=1.2,2.4,1.7,0.05,1,15,0,8,25.15,0.05,0.55,0.5625,0,0,1,0,-0.014,0.066,0,0,13617856,14736596,15657958,16447991";

const MIN_MS = 1700;       // long enough to read the wordmark
const REDUCED_MIN_MS = 700;
const MAX_MS = 4000;       // never trap anyone behind it
const EXIT_MS = 700;       // matches .intro-leaving in index.html
const SHOWN_MS = 1200;     // once the picture appears, let it be seen for at least this long

/** Whether this start deserves the full intro (not after a silent auto-update reload). */
export function shouldPlay(storage = globalThis.sessionStorage) {
  try {
    return storage?.getItem("snapcal.justUpdated") !== "1";
  } catch {
    return true;
  }
}

function start() {
  const intro = document.getElementById("intro");
  if (!intro) return;
  if (!shouldPlay()) return intro.remove();

  const reduced = matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  intro.classList.add("intro-playing");

  let mount = null;
  let shownAt = null; // when the moving picture appeared
  const began = performance.now();
  import("/vendor/fluid-bg/core.js")
    .then(({ mountNative }) => {
      if (!intro.isConnected) return;
      mount = mountNative(intro.querySelector(".intro-fluid"), INTRO_HASH);
      // a timer, not requestAnimationFrame: the fade must start even where frames are throttled
      setTimeout(() => {
        intro.classList.add("intro-fluid-in");
        shownAt = performance.now();
        setTimeout(maybeLeave, SHOWN_MS);
      }, 30);
    })
    .catch(() => { /* no WebGL: the paper cover and wordmark still work */ })
    .finally(() => { if (!mount) shownAt = began - SHOWN_MS; }); // nothing to wait for
  const appRoot = document.getElementById("app-root");
  let appDrawn = Boolean(appRoot?.children.length);
  let left = false;

  const leave = () => {
    if (left) return;
    left = true;
    observer.disconnect();
    intro.classList.add("intro-leaving");
    setTimeout(() => {
      try { mount?.destroy(); } catch { /* already gone */ }
      intro.remove();
    }, EXIT_MS);
  };
  const maybeLeave = () => {
    const now = performance.now();
    if (!appDrawn || now - began < (reduced ? REDUCED_MIN_MS : MIN_MS)) return;
    if (!reduced && (shownAt === null || now - shownAt < SHOWN_MS)) return;
    leave();
  };

  const observer = new MutationObserver(() => {
    if (appRoot.children.length) { appDrawn = true; maybeLeave(); }
  });
  if (appRoot) observer.observe(appRoot, { childList: true });
  else appDrawn = true;

  setTimeout(maybeLeave, reduced ? REDUCED_MIN_MS : MIN_MS);
  setTimeout(leave, MAX_MS);
  intro.addEventListener("click", () => { if (appDrawn) leave(); }); // impatient tap skips it
}

if (typeof document !== "undefined") start();
