// streak.js — the streak, made worth keeping:
//   - the streak sheet (tap the streak on Home): today's run, the best, freezes in the bank, the
//     next milestone, and the last five weeks as dots (logged, saved by a freeze, missed);
//   - a celebration the first time each milestone is reached (3, 7, 14, 30 … days);
//   - a short note when a freeze saved the streak or a new one was earned.
// The rules live in nutrition.nextStreakState; store.syncStreak keeps the profile up to date.

import * as store from "../store.js";
import { t, formatNumber, formatDate, weekdayLabels } from "../i18n.js";
import { openSheet, navBar, wireNavBar } from "./sheet.js";
import { icon } from "./icons.js";
import { addDayKey, nextMilestone, MAX_FREEZES, FREEZE_EVERY, localDateString } from "../nutrition.js";
import { sfx } from "../sounds.js";

const freezesHtml = (n) => Array.from({ length: MAX_FREEZES }, (_, i) =>
  `<span class="st-freeze${i < n ? " is-on" : ""}" aria-hidden="true">${icon("freeze", { size: 16 })}</span>`).join("");

export function openStreakSheet() {
  const res = store.syncStreak();
  const st = res.state;
  const n = res.streak;
  const next = nextMilestone(n);
  const today = localDateString(Date.now());
  const logged = store.loggedDayKeys();
  const frozen = new Set(st.frozenDays ?? []);
  // five weeks, Monday first, ending with this week
  const end = new Date(`${today}T12:00:00`);
  const toSunday = (7 - ((end.getDay() + 6) % 7) - 1);
  const last = addDayKey(today, toSunday);
  const days = Array.from({ length: 35 }, (_, i) => addDayKey(last, i - 34));
  const prevMilestone = [0, ...[3, 7, 14, 30, 50, 100, 150, 200, 365].filter((m) => m <= n)].pop();
  const pct = next ? Math.round(((n - prevMilestone) / (next - prevMilestone)) * 100) : 100;

  openSheet({
    render(panel, close) {
      panel.innerHTML = `
        ${navBar({ title: t("streak.title"), leading: { label: t("app.close") } })}
        <div class="sheet-panel-body st-body">
          <div class="st-hero">
            ${icon("flameFill", { size: 34, color: "var(--sc-streak-flame)" })}
            <div class="st-big">${formatNumber(n)}</div>
            <div class="st-sub">${n === 1 ? t("streak.dayInRow") : t("streak.daysInRow")}</div>
          </div>
          <div class="st-stats">
            <div><b>${formatNumber(st.best ?? n)}</b><small>${t("streak.best")}</small></div>
            <div><span class="st-freezes">${freezesHtml(st.freezes ?? 0)}</span><small>${t("streak.freezes")}</small></div>
            <div><b>${next ?? "—"}</b><small>${t("streak.next")}</small></div>
          </div>
          ${next ? `<div class="st-progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span></div>
          <p class="st-note">${t("streak.toGo", { n: next - n, m: next })}</p>` : ""}
          <div class="st-cal" role="img" aria-label="${t("streak.calendar")}">
            ${weekdayLabels().map((d) => `<span class="st-wk" aria-hidden="true">${d.slice(0, 1)}</span>`).join("")}
            ${days.map((k) => {
              const cls = k > today ? "is-future" : logged.has(k) ? "is-logged" : frozen.has(k) ? "is-frozen" : "is-missed";
              return `<span class="st-day ${cls}${k === today ? " is-today" : ""}" title="${formatDate(new Date(`${k}T12:00:00`), { weekday: "short", month: "short", day: "numeric" })}">${cls === "is-frozen" ? icon("freeze", { size: 11 }) : ""}</span>`;
            }).join("")}
          </div>
          <div class="st-legend"><span><i class="st-day is-logged"></i>${t("streak.legLogged")}</span><span><i class="st-day is-frozen"></i>${t("streak.legFrozen")}</span><span><i class="st-day is-missed"></i>${t("streak.legMissed")}</span></div>
          <div class="whatsnew-item"><div class="whatsnew-item-title">${t("streak.howTitle")}</div><p class="whatsnew-item-body">${t("streak.howBody", { every: FREEZE_EVERY, max: MAX_FREEZES })}</p></div>
        </div>`;
      wireNavBar(panel, { onLeading: () => close() });
    },
  });
}

/** After a sync: celebrate a new milestone, or say a freeze was used or earned. True if shown. */
export function announceStreak(res) {
  if (!res || document.querySelector(".sheet-panel")) return false;
  if (res.milestone) {
    store.markMilestoneSeen(res.milestone);
    try { sfx("streak"); } catch { /* sound off */ }
    const next = nextMilestone(res.milestone);
    openSheet({
      render(panel, close) {
        panel.innerHTML = `
          <div class="whatsnew st-cele">
            <div class="st-hero">
              ${icon("flameFill", { size: 48, color: "var(--sc-streak-flame)" })}
              <div class="st-big">${formatNumber(res.milestone)}</div>
              <div class="st-sub">${t("streak.celeTitle")}</div>
            </div>
            <p class="gu-lead st-cele-lead">${t(`streak.cele${res.milestone >= 30 ? "Big" : "Small"}`, { n: res.milestone })}</p>
            ${res.earned ? `<p class="st-cele-earn">${icon("freeze", { size: 15 })} ${t("streak.earned")}</p>` : ""}
            ${next ? `<p class="whatsnew-note">${t("streak.nextOne", { n: next })}</p>` : ""}
            <div class="push-actions"><button type="button" class="acct-btn is-primary" data-st="ok">${t("streak.keepGoing")}</button></div>
          </div>`;
        panel.querySelector('[data-st="ok"]').addEventListener("click", close);
      },
    });
    return true;
  }
  if (res.used?.length) { toast(t("streak.saved", { n: res.used.length })); return true; }
  if (res.earned) { toast(t("streak.earned")); return true; }
  return false;
}

let toastTimer = null;
function toast(text) {
  document.getElementById("undo-toast")?.remove();
  clearTimeout(toastTimer);
  const el = document.createElement("div");
  el.id = "undo-toast";
  el.className = "undo-toast";
  el.innerHTML = `${icon("freeze", { size: 16 })}<span class="undo-text"></span>`;
  el.querySelector(".undo-text").textContent = text;
  document.body.appendChild(el);
  toastTimer = setTimeout(() => el.remove(), 4500);
}
