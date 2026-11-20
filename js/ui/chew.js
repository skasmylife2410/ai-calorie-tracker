// chew.js — what the app shows while the AI works on something you logged: the Boca0 mascot
// (the bite with happy eyes and two teeth) chewing, crumbs flying off its bite, and a short line
// that moves through what it's doing ("Looking at your plate…" → "Weighing the portions…" →
// "Counting the calories…"). Pure CSS animation (css/app.css .chew); still for reduced motion.

import { t } from "../i18n.js";

let n = 0;

/**
 * The chewing mascot. `size` in px; `paper` is the colour of the eyes and teeth (the surface it
 * sits on: they read as cut-outs, like the logo).
 */
export function chewHtml(size = 24, { paper = "" } = {}) {
  const id = `chew-${++n}`;
  return `<span class="chew" style="--chew-size:${size}px${paper ? `;--chew-paper:${paper}` : ""}" aria-hidden="true">
    <svg class="chew-svg" viewBox="4 6 92 92">
      <defs><mask id="${id}"><rect x="0" y="0" width="100" height="100" fill="#fff"/><circle cx="82" cy="20" r="19" fill="#000"/><circle cx="64" cy="9" r="12" fill="#000"/><circle cx="95" cy="42" r="12" fill="#000"/></mask></defs>
      <g class="chew-head">
        <circle cx="50" cy="52" r="40" fill="currentColor" mask="url(#${id})"/>
        <path class="chew-eye" d="M31.5 43a5.6 5.6 0 0 1 11 0" fill="none" stroke-width="3.4" stroke-linecap="round"/>
        <path class="chew-eye" d="M54.5 43a5.6 5.6 0 0 1 11 0" fill="none" stroke-width="3.4" stroke-linecap="round"/>
        <g class="chew-teeth">
          <path d="M39.6 55h9.6v9.8a3.2 3.2 0 0 1-3.2 3.2h-3.2a3.2 3.2 0 0 1-3.2-3.2Z"/>
          <path d="M50.8 55h9.6v9.8a3.2 3.2 0 0 1-3.2 3.2h-3.2a3.2 3.2 0 0 1-3.2-3.2Z"/>
        </g>
      </g>
      <circle class="chew-crumb c1" cx="76" cy="30" r="4.2" fill="currentColor"/>
      <circle class="chew-crumb c2" cx="81" cy="34" r="3.4" fill="currentColor"/>
      <circle class="chew-crumb c3" cx="73" cy="37" r="3" fill="currentColor"/>
    </svg>
  </span>`;
}

// what it's doing, by kind of log; each line stays ~2.6 s and the last one holds
const STAGES = {
  meal: ["look", "spot", "weigh", "count", "almost"],
  label: ["label", "numbers", "almost"],
  text: ["read", "match", "count", "almost"],
  exercise: ["workout", "burn"],
  leftovers: ["leftover", "subtract"],
  fix: ["fix", "count", "almost"],
};
export const STAGE_MS = 2600;

/** The line to show `elapsedMs` into working on a `kind` of log. */
export function stageText(kind, elapsedMs) {
  const list = STAGES[kind] ?? STAGES.meal;
  const i = Math.min(list.length - 1, Math.max(0, Math.floor(elapsedMs / STAGE_MS)));
  return t(`chew.${list[i]}`);
}

/** Mascot + the moving line, for a sheet or a row that's waiting on the AI. Call `tick` to move it on. */
export function thinkingHtml(kind, { size = 22, startedAt = Date.now() } = {}) {
  return `<span class="chew-line" data-chew-kind="${kind}" data-chew-start="${startedAt}">${chewHtml(size)}<span class="chew-text">${stageText(kind, Date.now() - startedAt)}</span></span>`;
}

/** Moves every waiting line inside `root` on to its current stage (with a soft fade when it changes). */
export function tickThinking(root, now = Date.now()) {
  root?.querySelectorAll?.("[data-chew-kind]").forEach((el) => {
    const next = stageText(el.dataset.chewKind, now - Number(el.dataset.chewStart));
    const span = el.querySelector(".chew-text");
    if (span && span.textContent !== next) {
      span.classList.remove("is-new");
      void span.offsetWidth; // restart the fade
      span.textContent = next;
      span.classList.add("is-new");
    }
  });
}

/** Keeps the lines inside `root` moving until it leaves the page. */
export function keepThinking(root) {
  const id = setInterval(() => { if (!root?.isConnected) clearInterval(id); else tickThinking(root); }, 400);
  return () => clearInterval(id);
}
