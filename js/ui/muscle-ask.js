// muscle-ask.js — once per account: "Building muscle too?" For someone losing fat or keeping their
// weight the answer changes the plan (more protein, losing fat at the steady pace, a check-in that
// allows for the muscle on the scale), so the sheet shows their own numbers both ways first. On
// the "Build muscle" goal there's nothing to ask: it shows what changed. The answer is kept on the
// profile (buildMuscle), so another phone doesn't ask again; Profile › Goal changes it later.

import * as store from "../store.js";
import { t, formatNumber } from "../i18n.js";
import { openSheet } from "./sheet.js";
import { resolveUserGoals, goalOf, KCAL_PER_KG, RECOMP_LEAN_KG_PER_WEEK } from "../nutrition.js";
import { musclePatch } from "./formfields.js";

const SEEN_KEY = "snapcal.muscleAskSeen";
const ROWS = [["calories", "kcal"], ["proteinG", "g"], ["carbsG", "g"], ["fatG", "g"]];

const lb = () => store.weightUnit() === "lb";
const wt = (kg) => `${formatNumber(Math.round((lb() ? store.kgToLb(kg) : kg) * 10) / 10, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ${lb() ? "lb" : "kg"}`;

/** The targets this profile gets, with the maintenance the app really uses. */
function numbers(profile) {
  const g = resolveUserGoals(profile, { learnedTdee: store.maintenanceLock(profile)?.tdee ?? null });
  return { calories: Math.round(g.targetCalories), proteinG: Math.round(g.proteinTargetG), carbsG: Math.round(g.carbsTargetG), fatG: Math.round(g.fatTargetG) };
}

function tableHtml(a, b, [left, right]) {
  return `
    <table class="gu-table">
      <thead><tr><th></th><td>${left}</td><td></td><td>${right}</td></tr></thead>
      <tbody>${ROWS.map(([k, unit]) => {
        const same = Math.abs(a[k] - b[k]) <= 2;
        return `<tr${same ? ' class="gu-same"' : ""}><th>${t(`goalsUpdate.${k}`)}</th><td class="gu-old">${formatNumber(a[k])}</td><td class="gu-arrow" aria-hidden="true">${same ? "=" : "→"}</td><td class="gu-new">${formatNumber(b[k])} <small>${unit}</small></td></tr>`;
      }).join("")}</tbody>
    </table>`;
}

const item = (title, body) => `
  <div class="whatsnew-item"><div class="whatsnew-item-title">${title}</div><p class="whatsnew-item-body">${body}</p></div>`;

/** Whether this profile hasn't answered yet (and has the numbers the question needs). */
export function needsMuscleAnswer(profile = store.getProfile()) {
  return typeof profile.buildMuscle !== "boolean" && Number(profile.weightKg) > 0 && Number(profile.heightCm) > 0;
}

/** Asks once per account (and at most once per phone). True if a sheet was shown. */
export function maybeAskMuscle({ force = false } = {}) {
  const profile = store.getProfile();
  if (!force && !needsMuscleAnswer(profile)) return false;
  let seen = null;
  try { seen = localStorage.getItem(SEEN_KEY); } catch { /* private mode */ }
  if (seen && !force) return false;
  try { localStorage.setItem(SEEN_KEY, "1"); } catch { /* private mode */ }

  const goal = goalOf(profile);
  const without = numbers({ ...profile, buildMuscle: false });
  const withPatch = goal === "gain" ? { buildMuscle: true } : musclePatch(true, profile);
  const withMuscle = numbers({ ...profile, ...withPatch });
  const answer = (patch) => {
    store.setProfile(patch);
    try { store.syncLearnedTdeeFlag(); } catch { /* never block */ }
  };
  // the "Build muscle" goal already is: nothing to show if its numbers didn't move
  if (goal === "gain" && Math.abs(withMuscle.proteinG - without.proteinG) <= 2) { answer({ buildMuscle: true }); return false; }

  // only when it really goes up: someone very active losing fat can already be at the top
  const proteinItem = withMuscle.proteinG - without.proteinG > 2
    ? item(t("muscle.proteinTitle"), t(`muscle.protein${{ gain: "Gain", lose: "Lose", maintain: "Keep" }[goal]}`, { g: formatNumber(withMuscle.proteinG) }))
    : "";
  openSheet({
    render(panel, close) {
      const done = (lead) => {
        panel.innerHTML = `
          <div class="whatsnew muscle-ask">
            <h2 class="whatsnew-title">${t("muscle.doneTitle")}</h2>
            <p class="gu-lead">${lead}</p>
            ${tableHtml(without, withMuscle, [t("goalsUpdate.before"), t("goalsUpdate.now")])}
            ${proteinItem}
            <p class="whatsnew-note">${t("muscle.note")}</p>
            <div class="push-actions"><button type="button" class="acct-btn is-primary" data-ma="ok">${t("muscle.ok")}</button></div>
          </div>`;
        panel.querySelector('[data-ma="ok"]').addEventListener("click", close);
      };
      if (goal === "gain") { answer({ buildMuscle: true }); done(t("muscle.gainLead")); return; }

      const fromPace = Math.abs(Number(profile.targetDeltaKcal) || 0) * 7 / KCAL_PER_KG;
      const toPace = Math.abs(withPatch.targetDeltaKcal) * 7 / KCAL_PER_KG;
      panel.innerHTML = `
        <div class="whatsnew muscle-ask">
          <h2 class="whatsnew-title">${t("muscle.askTitle")}</h2>
          <p class="gu-lead">${t("muscle.askLead")}</p>
          ${tableHtml(without, withMuscle, [t("goalsUpdate.now"), t("muscle.with")])}
          ${proteinItem}
          ${goal === "lose" && fromPace - toPace >= 0.05 ? item(t("muscle.paceTitle"), t("muscle.paceBody", { from: wt(fromPace), to: wt(toPace) })) : ""}
          ${item(t("muscle.checkTitle"), t("muscle.checkBody", { lean: wt(RECOMP_LEAN_KG_PER_WEEK * 4) }))}
          <p class="whatsnew-note">${t("muscle.note")}</p>
          <div class="push-actions">
            <button type="button" class="acct-btn" data-ma="no">${t("muscle.no")}</button>
            <button type="button" class="acct-btn is-primary" data-ma="yes">${t("muscle.yes")}</button>
          </div>
        </div>`;
      panel.querySelector('[data-ma="no"]').addEventListener("click", () => { answer({ buildMuscle: false }); close(); });
      panel.querySelector('[data-ma="yes"]').addEventListener("click", () => { answer(withPatch); done(t("muscle.doneLead")); });
    },
  });
  return true;
}
