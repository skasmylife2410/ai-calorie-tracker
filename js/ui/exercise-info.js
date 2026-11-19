// exercise-info.js — "How exercise is counted": every activity, what 30 minutes of it burns for
// this person, how the number is worked out (nutrition.estimateCaloriesBurned), how much of it
// goes into the day's budget (nutrition.creditRatioFor) and why. It opens with the part that
// matters most: a workout can't outpace what's on the plate.
//
// Every number here is computed from the same functions the app logs with, for this person's
// body, so the page can't drift from what the app really does.

import * as store from "../store.js";
import { t, formatNumber } from "../i18n.js";
import { openSheet, navBar, wireNavBar } from "./sheet.js";
import { estimateCaloriesBurned, ACTIVITY_METS, INTENSITY_FACTORS, AUTO_CREDIT_BY_ACTIVITY } from "../nutrition.js";

export const INFO_ACTIVITIES = ["walk", "run", "soccer", "gym", "cycling", "swim", "other"];

// Food a burn is weighed against, everyday portions in Colombia and elsewhere (kcal)
const AREPA_WITH_CHEESE = 320;
const SODA_AND_PASTRY = 140 + 300; // a 350 ml soda and a pastry

/** What `minutes` of an activity burns for this profile at each intensity. */
export function burnFor(activity, minutes, profile = store.getProfile()) {
  const body = store.bodyOf(profile);
  return Object.fromEntries(Object.keys(INTENSITY_FACTORS).map((intensity) =>
    [intensity, estimateCaloriesBurned({ activity, minutes, intensity, ...body })]));
}

/** The numbers the page shows, for this profile (kept apart so tests can check them). */
export function exerciseFacts(profile = store.getProfile()) {
  const walkHour = burnFor("walk", 60, profile).moderate;
  const runToUndo = (() => {
    // minutes of a moderate run that a soda and a pastry take back
    const perMinute = burnFor("run", 60, profile).moderate / 60;
    return perMinute > 0 ? Math.round(SODA_AND_PASTRY / perMinute) : null;
  })();
  const ratio = store.exerciseCreditRatio();
  const auto = profile.exerciseCreditPct === undefined || profile.exerciseCreditPct === null || profile.exerciseCreditPct === "" || profile.exerciseCreditPct === "auto";
  return {
    walkHour,
    arepas: Math.round((walkHour / AREPA_WITH_CHEESE) * 10) / 10,
    runToUndo,
    activities: INFO_ACTIVITIES.map((key) => ({ key, met: ACTIVITY_METS[key], ...burnFor(key, 30, profile) })),
    creditPct: Math.round(ratio * 100),
    auto,
  };
}

export function openExerciseInfoSheet() {
  const f = exerciseFacts();
  openSheet({
    render(panel, close) {
      panel.innerHTML = `
        ${navBar({ title: t("exInfo.navTitle"), leading: { label: t("app.close") } })}
        <div class="sheet-panel-body exi-body">
          <div class="exi-lead">
            <h2 class="exi-lead-title">${t("exInfo.leadTitle")}</h2>
            <p>${t("exInfo.leadWalk", { kcal: formatNumber(f.walkHour) })} ${f.arepas < 0.8 ? t("exInfo.arepaLess", { kcal: AREPA_WITH_CHEESE })
              : f.arepas <= 1.2 ? t("exInfo.arepaOne") : t("exInfo.arepaMany", { n: formatNumber(Math.round(f.arepas * 2) / 2) })}</p>
            ${f.runToUndo ? `<p>${t("exInfo.leadUndo", { min: formatNumber(f.runToUndo) })}</p>` : ""}
            <p>${t("exInfo.leadWhy")}</p>
          </div>

          <div class="exi-h">${t("exInfo.perTitle")}</div>
          <div class="exi-card">
            ${f.activities.map((a) => `
              <div class="exi-row">
                <div class="exi-row-top">
                  <b>${t(`exercise.activities.${a.key}`)}</b>
                  <span class="exi-kcal"><b>${formatNumber(a.moderate)}</b> kcal</span>
                </div>
                <div class="exi-range">${t("exInfo.range", { easy: formatNumber(a.easy), hard: formatNumber(a.hard) })}</div>
                <p class="exi-note">${t(`exInfo.notes.${a.key}`)}</p>
              </div>`).join("")}
          </div>
          <p class="exi-small">${t("exInfo.perFoot")}</p>

          <div class="exi-h">${t("exInfo.howTitle")}</div>
          <ol class="exi-steps">
            <li>${t("exInfo.how1", { mets: f.activities.map((a) => `${t(`exercise.activities.${a.key}`).toLowerCase()} ${formatNumber(a.met)}`).join(", ") })}</li>
            <li>${t("exInfo.how2")}</li>
            <li>${t("exInfo.how3")}</li>
          </ol>

          <div class="exi-h">${t("exInfo.creditTitle")}</div>
          <div class="exi-card exi-pad">
            <p>${f.creditPct > 0 ? t("exInfo.creditOn", { pct: f.creditPct }) : t("exInfo.creditOff")}</p>
            <p>${t("exInfo.creditWhy")}</p>
            ${f.auto ? `<p>${t("exInfo.creditAuto", {
              sedentary: Math.round(AUTO_CREDIT_BY_ACTIVITY.sedentary * 100), light: Math.round(AUTO_CREDIT_BY_ACTIVITY.light * 100),
              moderate: Math.round(AUTO_CREDIT_BY_ACTIVITY.moderate * 100), active: Math.round(AUTO_CREDIT_BY_ACTIVITY.veryActive * 100),
            })}</p>` : ""}
            <p class="exi-small">${t("exInfo.creditChange")}</p>
          </div>

          <div class="exi-h">${t("exInfo.watchTitle")}</div>
          <p class="exi-text">${t("exInfo.watch")}</p>
        </div>`;
      wireNavBar(panel, { onLeading: () => close() });
    },
  });
}
