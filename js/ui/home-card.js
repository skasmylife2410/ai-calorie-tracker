// home-card.js — decides what the card under the doodle says.
//
// It used to be the same personal message all day, which got repetitive fast. Now four kinds
// take turns, changing every 12 hours:
//   weekend   — Thursday evening to Sunday, with THEIR weekday-vs-weekend number
//   myth      — the day's myth, tap to see the evidence
//   tip       — how to log more accurately
//   personal  — the streak/protein/goal message
// The weekend heads-up wins when it applies, because it's the one that's time-sensitive.

import * as store from "../store.js";
import { mythForDay } from "../myths.js";
import { tipForSlot } from "../tips.js";
import { doodleMessage, currentSlot } from "./doodle-messages.js";
import { t, currentLanguage, formatNumber } from "../i18n.js";

/** Thursday evening through Sunday — when a heads-up is still useful. */
export function isWeekendWindow(date = new Date()) {
  const day = date.getDay(); // 0 Sun … 6 Sat
  const hour = date.getHours();
  if (day === 5 || day === 6 || day === 0) return true;      // Fri, Sat, Sun
  if (day === 4 && hour >= 17) return true;                   // Thursday evening
  return false;
}

/**
 * @returns {{kind:string, title:string, body:string, tone?:string, interactive?:boolean}}
 */
export function homeCard({ now = new Date(), ctx, username = "", lang = "en" } = {}) {
  const slot = currentSlot(now.getTime());
  const kinds = isWeekendWindow(now) ? ["weekend", "myth", "tip", "personal"] : ["personal", "myth", "tip"];
  const kind = kinds[((slot % kinds.length) + kinds.length) % kinds.length];

  if (kind === "weekend") {
    const gap = store.weekendGap({ now: now.getTime() });
    const day = now.getDay();
    const key = day === 0 ? "sunday" : day === 6 ? "saturday" : "ahead";
    // Their own number when we have it: far more persuasive than a generic warning, and it
    // stays factual rather than scolding.
    const body = gap && gap.gap > 150
      ? t("weekend.withNumber", { n: formatNumber(gap.gap), weekends: gap.weekends })
      : gap && gap.gap < -150
        ? t("weekend.under", { n: formatNumber(Math.abs(gap.gap)) })
        : t(`weekend.${key}Body`);
    return { kind, title: t(`weekend.${key}Title`), body, tone: "weekend" };
  }

  if (kind === "myth") {
    const m = mythForDay(now);
    const text = m[lang === "es" ? "es" : "en"];
    return { kind, title: t("myth.label"), body: `“${text.myth}”`, answer: text.truth, tone: "myth", interactive: true };
  }

  if (kind === "tip") {
    const tip = tipForSlot(slot, lang === "es" ? "es" : "en");
    return { kind, title: tip.t, body: tip.b, tone: "tip" };
  }

  return { kind: "personal", title: t(`doodle.${ctx.state}Title`), body: doodleMessage(ctx, { lang, username, now: now.getTime() }) };
}
