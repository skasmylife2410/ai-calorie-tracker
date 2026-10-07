// coach.js — sharing your meal log with your coach (the app's owner), by choice.
//   - Profile › Coach: a switch, with exactly what's shared, off by default, off again any time.
//   - A one-time question the next time the app opens (never for the coach).
//   - The coach's view: everyone sharing, then one person's meals day by day, photos included.
// The server checks the switch on every request (api/compare.js, op "coach"/"coachMeals").

import { safeSrc } from "../safe-src.js";
import * as store from "../store.js";
import { t, formatNumber, formatDate } from "../i18n.js";
import { openSheet, navBar, wireNavBar } from "./sheet.js";
import { apiFetch } from "../net.js";
import { localDateString } from "../nutrition.js";

export const COACH = "aelson"; // same account as api/_members.js ADMIN
export const COACH_ASK_KEY = "snapcal.coachAskSeen";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const me = () => { try { return (localStorage.getItem("snapcal.username") || "").toLowerCase(); } catch { return ""; } };
export const isCoach = () => me() === COACH;

/** Turns sharing on or off (the profile syncs; the server reads it from there). */
export function setShareWithCoach(on) {
  store.setProfile({ shareWithCoach: Boolean(on), shareWithCoachAt: on ? Date.now() : null });
}

// --- Profile section --------------------------------------------------------------------------

export function coachSectionHtml() {
  if (isCoach()) {
    return `
      <div class="ios-section">
        <div class="ios-section-header">${t("coach.section")}</div>
        <div class="ios-section-body">
          <button type="button" class="ios-row coach-open" id="coach-open"><div class="ios-row-label">${t("coach.open")}</div><div class="ios-row-value">›</div></button>
        </div>
        <div class="ios-section-footer">${t("coach.openHint")}</div>
      </div>`;
  }
  const on = store.getProfile().shareWithCoach === true;
  return `
    <div class="ios-section">
      <div class="ios-section-header">${t("coach.section")}</div>
      <div class="ios-section-body">
        <label class="ios-row coach-switch">
          <div class="ios-row-label">${t("coach.share")}</div>
          <input type="checkbox" role="switch" id="coach-share" ${on ? "checked" : ""}>
        </label>
      </div>
      <div class="ios-section-footer">${t(on ? "coach.onHint" : "coach.offHint")}</div>
    </div>`;
}

export function wireCoachSection(container, { onChange } = {}) {
  container.querySelector("#coach-open")?.addEventListener("click", () => openCoachSheet());
  container.querySelector("#coach-share")?.addEventListener("change", (e) => { setShareWithCoach(e.target.checked); onChange?.(); });
}

// --- One-time question --------------------------------------------------------------------------

/** Asks once per phone whether to share with the coach. True if it showed. */
export function maybeAskCoachShare({ force = false } = {}) {
  if (isCoach() || !me()) return false;
  const p = store.getProfile();
  if (p.shareWithCoach === true) return false;
  let seen = null;
  try { seen = localStorage.getItem(COACH_ASK_KEY); } catch { /* private mode */ }
  if (seen && !force) return false;
  try { localStorage.setItem(COACH_ASK_KEY, "1"); } catch { /* private mode */ }
  openSheet({
    render(panel, close) {
      panel.innerHTML = `
        <div class="whatsnew coach-ask">
          <h2 class="whatsnew-title">${t("coach.askTitle")}</h2>
          <p class="gu-lead">${t("coach.askLead")}</p>
          <div class="whatsnew-item"><div class="whatsnew-item-title">${t("coach.whatTitle")}</div><p class="whatsnew-item-body">${t("coach.whatBody")}</p></div>
          <div class="whatsnew-item"><div class="whatsnew-item-title">${t("coach.notTitle")}</div><p class="whatsnew-item-body">${t("coach.notBody")}</p></div>
          <div class="whatsnew-item"><div class="whatsnew-item-title">${t("coach.offTitle")}</div><p class="whatsnew-item-body">${t("coach.offBody")}</p></div>
          <div class="push-actions">
            <button type="button" class="acct-btn" data-ca="no">${t("coach.no")}</button>
            <button type="button" class="acct-btn is-primary" data-ca="yes">${t("coach.yes")}</button>
          </div>
        </div>`;
      panel.querySelector('[data-ca="no"]').addEventListener("click", close);
      panel.querySelector('[data-ca="yes"]').addEventListener("click", () => { setShareWithCoach(true); close(); });
    },
  });
  return true;
}

// --- The coach's view ---------------------------------------------------------------------------

async function post(body) {
  const res = await apiFetch("/api/compare", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || out.errorType) throw new Error(out.message || t("coach.loadFailed"));
  return out;
}

const time = (ts) => new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

export function openCoachSheet() {
  let person = null;        // the person open, or null for the list
  let day = localDateString(Date.now());
  let people = null;

  openSheet({
    render(panel, close) {
      const frame = (title, body, { back = false } = {}) => {
        panel.innerHTML = `
          ${navBar({ title, leading: { label: back ? t("coach.back") : t("app.close") } })}
          <div class="sheet-panel-body coach-body">${body}</div>`;
        wireNavBar(panel, { onLeading: () => (back ? (person = null, list()) : close()) });
      };

      const list = async () => {
        frame(t("coach.title"), `<div class="left-working"><span class="left-spin" aria-hidden="true"></span>${t("coach.loading")}</div>`);
        try {
          if (!people) people = (await post({ op: "coach" })).people ?? [];
        } catch (err) {
          frame(t("coach.title"), `<p class="left-lead">${esc(err.message)}</p>`);
          return;
        }
        const today = localDateString(Date.now());
        frame(t("coach.title"), people.length
          ? `<p class="left-lead">${t("coach.listLead", { n: people.length })}</p>
             <div class="left-list">${people.map((p) => {
               const d = p.days?.[today];
               const goal = p.goals?.calories;
               return `
                 <button type="button" class="left-meal coach-person" data-owner="${esc(p.owner)}">
                   ${p.avatar ? `<img src="${safeSrc(p.avatar)}" alt="">` : `<span class="left-meal-ph coach-initial">${esc((p.name || p.owner).slice(0, 1).toUpperCase())}</span>`}
                   <span class="left-meal-text"><b>${esc(p.name || p.owner)}</b><small>${d ? t("coach.today", { kcal: formatNumber(d.calories), goal: goal ? formatNumber(goal) : "–", meals: d.meals ?? 0 }) : t("coach.nothingToday")}</small></span>
                   <span class="coach-chev">›</span>
                 </button>`;
             }).join("")}</div>`
          : `<p class="left-lead">${t("coach.nobody")}</p>`);
        panel.querySelectorAll(".coach-person").forEach((b) => b.addEventListener("click", () => {
          person = people.find((p) => p.owner === b.dataset.owner);
          day = localDateString(Date.now());
          meals();
        }));
      };

      const meals = async () => {
        const name = person.name || person.owner;
        frame(name, `<div class="left-working"><span class="left-spin" aria-hidden="true"></span>${t("coach.loading")}</div>`, { back: true });
        let out;
        try { out = await post({ op: "coachMeals", owner: person.owner, day }); } catch (err) {
          frame(name, `<p class="left-lead">${esc(err.message)}</p>`, { back: true });
          return;
        }
        const list = out.meals ?? [];
        const sum = (k) => list.reduce((a, m) => a + (Number(m[k]) || 0), 0);
        const g = out.goals ?? person.goals ?? {};
        const isToday = day === localDateString(Date.now());
        const dt = new Date(`${day}T12:00:00`);
        frame(name, `
          <div class="coach-day">
            <button type="button" class="tm-arrow" id="coach-prev" aria-label="${t("day.prevDay")}">‹</button>
            <b>${isToday ? t("us.today") : formatDate(dt, { weekday: "long", month: "short", day: "numeric" })}</b>
            <button type="button" class="tm-arrow${isToday ? " is-hidden" : ""}" id="coach-next" aria-label="${t("day.nextDay")}">›</button>
          </div>
          <div class="coach-totals">
            <div><b>${formatNumber(Math.round(sum("calories")))}</b><small>/ ${g.calories ? formatNumber(g.calories) : "–"} kcal</small></div>
            <div><b>${Math.round(sum("proteinG"))}g</b><small>/ ${g.proteinG ?? "–"} ${t("ui.protein")}</small></div>
            <div><b>${Math.round(sum("carbsG"))}g</b><small>/ ${g.carbsG ?? "–"} ${t("ui.carbs")}</small></div>
            <div><b>${Math.round(sum("fatG"))}g</b><small>/ ${g.fatG ?? "–"} ${t("ui.fat")}</small></div>
          </div>
          ${list.length ? list.map((m) => `
            <div class="coach-meal">
              ${m.photo ? `<img class="coach-photo" src="${safeSrc(m.photo)}" alt="">` : ""}
              <div class="coach-meal-head"><b>${esc(m.name)}</b><span>${time(m.ts)}</span></div>
              <div class="coach-meal-nums">${formatNumber(m.calories)} kcal · ${Math.round(m.proteinG)}P · ${Math.round(m.carbsG)}C · ${Math.round(m.fatG)}F${m.servings !== 1 ? ` · ×${m.servings}` : ""}${m.leftoverKcal ? ` · ${t("left.mark", { n: formatNumber(m.leftoverKcal) })}` : ""}</div>
              ${m.items.length > 1 ? `<ul class="coach-items">${m.items.map((i) => `<li>${esc(i.name)}${i.grams ? ` · ${i.grams} g` : ""} · ${formatNumber(i.calories)} kcal</li>`).join("")}</ul>` : ""}
            </div>`).join("") : `<p class="left-lead">${t("coach.noMeals")}</p>`}`, { back: true });
        const shift = (k) => { const d = new Date(`${day}T12:00:00`); d.setDate(d.getDate() + k); day = localDateString(d.getTime()); meals(); };
        panel.querySelector("#coach-prev")?.addEventListener("click", () => shift(-1));
        panel.querySelector("#coach-next")?.addEventListener("click", () => { if (!isToday) shift(1); });
      };

      list();
    },
  });
}
