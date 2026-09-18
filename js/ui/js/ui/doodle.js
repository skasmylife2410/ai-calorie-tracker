// doodle.js — the little character that reacts to how the day went. Pure SVG, no assets.
//
// Three states (see doodleState below):
//   strong    — on or under the goal, or a good protein day. Grows with the streak.
//   wellFed   — over the goal today. Sleepy on the couch. Resets tomorrow.
//   idle      — nothing logged for 2+ days. Rounder, streak stopped.
//
// Each person has their own (variant "a" / "b"), drawn from the profile.

import * as store from "../store.js";
import { localDateString } from "../nutrition.js";

export const STATES = ["strong", "wellFed", "idle"];

/**
 * Works out which doodle to show.
 * @param {Date} date day being viewed
 * @returns {{state:string, streak:number, daysSinceLog:number}}
 */
export function doodleState(date = new Date()) {
  const energy = store.dayEnergy(date);
  const streak = store.streak();
  const daysSinceLog = daysSinceLastLog(date);

  if (daysSinceLog >= 2) return { state: "idle", streak, daysSinceLog };
  if (energy.eaten > energy.adjustedTarget) return { state: "wellFed", streak, daysSinceLog };
  return { state: "strong", streak, daysSinceLog };
}

/** Whole days between the most recent logged day and `date`. 0 when something is logged today. */
export function daysSinceLastLog(date = new Date()) {
  const entries = store.allFoodEntries().filter((e) => e.isPending !== true);
  if (entries.length === 0) return Infinity;
  const newest = Math.max(...entries.map((e) => e.timestamp));
  const a = new Date(localDateString(newest) + "T00:00:00");
  const b = new Date(localDateString(date instanceof Date ? date.getTime() : date) + "T00:00:00");
  return Math.max(0, Math.round((b - a) / 86400000));
}

/**
 * How "grown" the strong doodle is: 0 at no streak, 1 from a week onward. Drives the weights and
 * how tall the character stands, so progress shows up over days rather than from one meal.
 */
export function growth(streak) {
  const n = Number(streak) || 0;
  return Math.max(0, Math.min(1, n / 7));
}

const INK = "var(--sc-primary-text)";
const MUTED = "var(--sc-secondary)";
const GOOD = "#2AA66B";

function hair(variant) {
  // variant "b" gets longer hair; both are doodles, not portraits.
  return variant === "b"
    ? `<path d="M45 24c0-10 7-16 15-16s15 6 15 16c0 6-3 9-3 9" /><path d="M75 20c6 5 7 14 4 22" />`
    : "";
}

function strongSvg(variant, streakGrowth) {
  const weight = 5 + Math.round(streakGrowth * 4); // dumbbells get heavier with the streak
  const lift = Math.round(streakGrowth * 4); // and they stand a touch taller
  return `
    <g transform="translate(0 ${-lift})">
      <circle cx="60" cy="26" r="15"/>
      ${hair(variant)}
      <path d="M53 24c1.5-1.5 3.5-1.5 5 0M62 24c1.5-1.5 3.5-1.5 5 0" stroke-width="3"/>
      <path d="M54 32c4 3.5 8 3.5 12 0" stroke-width="3"/>
      <path d="M46 52c0-7 6-11 14-11s14 4 14 11v18c0 4-3 7-7 7H53c-4 0-7-3-7-7z"/>
      <path d="M46 55L28 48M74 55l18-7" stroke-width="4"/>
      <circle cx="24" cy="46" r="${weight}" fill="${INK}" stroke="none"/>
      <circle cx="96" cy="44" r="${weight}" fill="${INK}" stroke="none"/>
      <path d="M54 77v28M66 77v28M54 105l-6 8M66 105l6 8"/>
      ${streakGrowth > 0.3 ? `<path d="M84 12v8M80 16h8" stroke="${GOOD}" stroke-width="3"/>` : ""}
    </g>`;
}

function wellFedSvg(variant) {
  return `
    <g>
      <path d="M22 96h76"/>
      <path d="M26 96V80c0-5 4-9 9-9h50c5 0 9 4 9 9v16" stroke="${MUTED}"/>
      <circle cx="52" cy="58" r="14"/>
      ${variant === "b" ? `<path d="M38 56c0-10 6-16 14-16s14 6 14 16"/>` : ""}
      <path d="M45 56h6M55 56h6" stroke-width="3"/>
      <path d="M47 65c3 2.5 7 2.5 10 0" stroke-width="3"/>
      <path d="M40 84c0-8 6-13 16-13s20 5 20 13v6H40z"/>
      <path d="M76 84l10 4" stroke-width="4"/>
      <path d="M64 24c3 3 3 7 0 10M74 20c4 4 4 9 0 13" stroke="${MUTED}" stroke-width="3"/>
    </g>`;
}

function idleSvg(variant) {
  return `
    <g>
      <circle cx="60" cy="28" r="15"/>
      ${hair(variant)}
      <path d="M53 26h6M62 26h6" stroke-width="3"/>
      <path d="M54 36c4-3 8-3 12 0" stroke-width="3"/>
      <ellipse cx="60" cy="72" rx="26" ry="24"/>
      <path d="M36 66c-7 2-11 6-12 11M84 66c7 2 11 6 12 11" stroke-width="4"/>
      <path d="M50 96v10M70 96v10M50 106l-7 6M70 106l7 6"/>
      <path d="M88 44h20" stroke="${MUTED}" stroke-width="3" stroke-dasharray="4 5"/>
    </g>`;
}

/**
 * @param {object} opts
 * @param {string} opts.state strong | wellFed | idle
 * @param {number} [opts.streak]
 * @param {"a"|"b"} [opts.variant]
 * @param {number} [opts.size] px
 * @param {boolean} [opts.animate] play the celebrate/settle animation once
 */
export function doodleSvg({ state = "strong", streak = 0, variant = "a", size = 120, animate = false } = {}) {
  const body =
    state === "wellFed" ? wellFedSvg(variant) : state === "idle" ? idleSvg(variant) : strongSvg(variant, growth(streak));
  return `
    <svg class="doodle${animate ? " doodle-animate" : ""}" data-state="${state}" width="${size}" height="${Math.round(size * 1.08)}"
         viewBox="0 0 120 130" fill="none" stroke="${INK}" stroke-width="3.4"
         stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="doodle">
      ${body}
    </svg>`;
}
