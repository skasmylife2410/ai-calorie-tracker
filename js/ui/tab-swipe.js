// tab-swipe.js — swipe left/right anywhere on a tab to move to the next/previous one.
//
// The page follows the finger, so you see the neighbouring tab's edge as you drag; letting go
// past about a third of the width commits, anything less springs back.
//
// Where a sideways swipe already means something else, that wins:
//   - Home's calorie/macros card pages sideways ([data-own-swipe] on it)
//   - anything that scrolls horizontally on its own (overflow-x)
//   - the outer 20px, where iPhone Safari's swipe-to-go-back lives
// Up/down scrolling is untouched: direction is decided in the first ~12px of movement.

const EDGE = 20;
const DECIDE = 8;      // px of movement before deciding sideways vs scroll
const COMMIT = 0.16;   // share of the width that commits — half the old 0.32, which felt like a haul
const FLICK = 0.45;    // px per ms: a quick flick commits even if it's short

export function wireTabSwipe({ surface, getIndex, count, onChange }) {
  let startX = 0, startY = 0, dx = 0;
  let tracking = false, decided = false, horizontal = false;
  let startT = 0;
  let width = 1;

  const ownsSwipe = (target) => {
    for (let el = target; el && el !== surface; el = el.parentElement) {
      if (el.hasAttribute?.("data-own-swipe")) return true;
      if (el.scrollWidth > el.clientWidth + 2) {
        const ox = getComputedStyle(el).overflowX;
        if (ox === "auto" || ox === "scroll") return true;
      }
      if (el.matches?.("input, textarea, select, [contenteditable]")) return true;
    }
    return false;
  };

  const reset = (animate) => {
    surface.style.transition = animate ? "transform .28s cubic-bezier(.2,.8,.3,1)" : "none";
    surface.style.transform = "";
  };

  surface.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    width = surface.clientWidth || window.innerWidth;
    if (t.clientX < EDGE || t.clientX > width - EDGE) return; // leave the edges to the system
    if (ownsSwipe(e.target)) return;
    startX = t.clientX; startY = t.clientY; dx = 0; startT = performance.now();
    tracking = true; decided = false; horizontal = false;
    surface.style.transition = "none";
  }, { passive: true });

  surface.addEventListener("touchmove", (e) => {
    if (!tracking) return;
    const t = e.touches[0];
    const mx = t.clientX - startX;
    const my = t.clientY - startY;
    if (!decided) {
      if (Math.abs(mx) < DECIDE && Math.abs(my) < DECIDE) return;
      decided = true;
      horizontal = Math.abs(mx) > Math.abs(my) * 1.2;
      if (!horizontal) { tracking = false; return; } // it's a scroll — hands off
    }
    if (e.cancelable) e.preventDefault();
    const i = getIndex();
    dx = mx * 1.15; // page moves slightly ahead of the finger, so short drags feel like enough
    // resist dragging past the first or last tab
    if ((i === 0 && dx > 0) || (i === count() - 1 && dx < 0)) dx = dx / 3.5;
    surface.style.transform = `translateX(${dx}px)`;
  }, { passive: false });

  const end = () => {
    if (!tracking) return;
    tracking = false;
    if (!decided || !horizontal) return reset(false);

    const i = getIndex();
    const next = dx < 0 ? i + 1 : i - 1;
    const speed = Math.abs(dx) / Math.max(1, performance.now() - startT);
    const farEnough = Math.abs(dx) > width * COMMIT;
    const flicked = speed > FLICK && Math.abs(dx) > 30;
    if ((farEnough || flicked) && next >= 0 && next < count()) {
      // slide the old page out, swap content, slide the new one in from the other side
      const dir = dx < 0 ? -1 : 1;
      surface.style.transition = "transform .16s ease-in";
      surface.style.transform = `translateX(${dir * width}px)`;
      setTimeout(() => {
        onChange(next);
        surface.style.transition = "none";
        surface.style.transform = `translateX(${-dir * width * 0.35}px)`;
        requestAnimationFrame(() => reset(true));
        if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") navigator.vibrate(8);
      }, 150);
    } else {
      reset(true);
    }
  };
  surface.addEventListener("touchend", end);
  surface.addEventListener("touchcancel", end);
}
