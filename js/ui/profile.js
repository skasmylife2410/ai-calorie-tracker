// profile.js — Profile / Settings tab (ProfileSettingsView in ContentView.swift), SPEC-UI.md §3.

import * as store from "../store.js";
import * as sync from "../sync.js";
import { t, currentLanguage, setLanguage, supportedLanguages } from "../i18n.js";
import { postAuth } from "./login.js";
import { setStoredToken } from "../net.js";
import { roundDisplay } from "../nutrition.js";
import { wireNumericInput } from "./numeric-field.js";
import {
  bodyStatsSectionHtml,
  activityLevelSectionHtml,
  goalSectionHtml,
  wireProfileFormFields,
  calculatorEstimateRowsHtml,
} from "./formfields.js";

const GOAL_FIELDS = [
  { key: "customTargetKcal", derivedKey: "targetCalories", id: "calories", label: "Calories", unit: "kcal", decimal: false },
  { key: "customProteinG", derivedKey: "proteinTargetG", id: "protein", label: "Protein", unit: "g", decimal: true },
  { key: "customCarbsG", derivedKey: "carbsTargetG", id: "carbs", label: "Carbs", unit: "g", decimal: true },
  { key: "customFatG", derivedKey: "fatTargetG", id: "fat", label: "Fat", unit: "g", decimal: true },
];

let currentUsername = "";
postAuth({ op: "whoami" }).then((out) => {
  if (out.ok && out.username !== currentUsername) {
    currentUsername = out.username;
    const el = document.querySelector("#tab-content");
    if (el && el.querySelector("#acct-change")) render(el);
  }
});

export function render(container) {
  const profile = store.getProfile();
  const goals = store.computeGoals();

  container.innerHTML = `
    <div class="navbar"><span class="navbar-spacer"></span><div class="navbar-title">Profile</div><span class="navbar-spacer"></span></div>
    <div class="ios-form">
      ${dailyGoalsSectionHtml(profile, goals)}
      <div class="ios-caption-block">These aren't required — only used if you want SnapCal to estimate your target for you.</div>
      ${bodyStatsSectionHtml(profile)}
      ${activityLevelSectionHtml(profile)}
      ${goalSectionHtml(profile)}
      ${goals.hasValidStats ? calculatorSectionHtml(goals) : ""}
      ${accountSectionHtml(currentUsername)}
      ${languageSectionHtml()}
      ${syncSectionHtml()}
      <div class="bottom-safe-spacer"></div>
    </div>
  `;

  wireProfileFormFields(container, profile, (patch) => store.setProfile(patch));
  wireDailyGoalsSection(container, profile, goals);
  wireCalculatorSection(container, goals);
  wireSyncSection(container);
  wireLanguage(container);
  wireAccount(container, currentUsername);
}

function syncStatusLabel({ state, lastSyncAt }) {
  if (state === "pending") return "Syncing…";
  if (state === "error") return "Error";
  if (state === "ok" && lastSyncAt) {
    const d = new Date(lastSyncAt);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `Synced ${hh}:${mm}`;
  }
  return "Off";
}

/** Account: who you are, change password, sign out. */
function accountSectionHtml(username) {
  return `
    <div class="ios-section">
      <div class="ios-section-header">${t("auth.account")}</div>
      <div class="ios-section-body">
        <div class="ios-row"><div class="ios-row-label">${t("auth.signedInAs")}</div><div class="ios-row-value">${username || "—"}</div></div>
        <div class="acct-actions">
          <button type="button" class="acct-btn" id="acct-change">${t("auth.changePassword")}</button>
          <button type="button" class="acct-btn is-danger" id="acct-signout">${t("auth.signOut")}</button>
        </div>
        <div class="acct-form hidden" id="acct-form">
          <input id="acct-current" class="auth-input" type="password" placeholder="${t("auth.currentPassword")}" autocomplete="current-password" />
          <input id="acct-new" class="auth-input" type="password" placeholder="${t("auth.newPassword")}" autocomplete="new-password" />
          <button type="button" class="auth-submit" id="acct-save">${t("app.save")}</button>
          <div class="acct-msg" id="acct-msg"></div>
        </div>
      </div>
    </div>`;
}

function wireAccount(container, username) {
  const form = container.querySelector("#acct-form");
  container.querySelector("#acct-change")?.addEventListener("click", () => form?.classList.toggle("hidden"));

  container.querySelector("#acct-save")?.addEventListener("click", async () => {
    const msg = container.querySelector("#acct-msg");
    const password = container.querySelector("#acct-current").value;
    const newPassword = container.querySelector("#acct-new").value;
    msg.textContent = t("auth.working");
    const out = await postAuth({ op: "change", username, password, newPassword });
    if (out.ok) {
      setStoredToken(out.token);
      msg.textContent = t("auth.changed");
      msg.classList.remove("is-error");
      container.querySelector("#acct-current").value = "";
      container.querySelector("#acct-new").value = "";
    } else {
      msg.textContent = out.message || t("errors.generic");
      msg.classList.add("is-error");
    }
  });

  container.querySelector("#acct-signout")?.addEventListener("click", () => {
    if (globalThis.confirm && !globalThis.confirm(t("auth.signOutConfirm"))) return;
    setStoredToken("");
    location.reload();
  });
}

/** Language picker — per person, stored on the profile so it follows them between devices. */
function languageSectionHtml() {
  const lang = currentLanguage();
  const label = { en: "profile.english", es: "profile.spanish" };
  return `
    <div class="ios-section">
      <div class="ios-section-header">${t("profile.language")}</div>
      <div class="ios-section-body">
        <div class="lang-row">
          ${supportedLanguages()
            .map((code) => `<button type="button" class="lang-btn${code === lang ? " is-on" : ""}" data-lang="${code}">${t(label[code])}</button>`)
            .join("")}
        </div>
      </div>
    </div>
  `;
}

function wireLanguage(container) {
  container.querySelectorAll("[data-lang]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const code = btn.dataset.lang;
      if (code === currentLanguage()) return;
      store.setProfile({ language: code }); // travels with this person's profile on sync
      await setLanguage(code);
    });
  });
}

function syncSectionHtml() {
  return `
    <div class="ios-section">
      <div class="ios-section-header">${t("profileScreen.sync")}</div>
      <div class="ios-section-body">
        <div class="ios-row linklike" id="sync-row">
          <div class="ios-row-label">${t("profileScreen.status")}</div>
          <div class="ios-row-spacer"></div>
          <div class="ios-row-value" id="sync-status-value">${syncStatusLabel(sync.getSyncStatus())}</div>
        </div>
      </div>
      <div class="ios-section-footer">${t("profileScreen.syncNow")}</div>
    </div>
  `;
}

function wireSyncSection(container) {
  const row = container.querySelector("#sync-row");
  if (!row) return;
  row.addEventListener("click", async () => {
    const valueEl = container.querySelector("#sync-status-value");
    if (valueEl) valueEl.textContent = syncStatusLabel({ state: "pending" });
    await sync.syncNow();
    const freshValueEl = container.querySelector("#sync-status-value");
    if (freshValueEl) freshValueEl.textContent = syncStatusLabel(sync.getSyncStatus());
  });
}

function dailyGoalsSectionHtml(profile, goals) {
  const rows = GOAL_FIELDS.map((f) => {
    const hasOverride = profile[f.key] !== null && profile[f.key] !== undefined;
    return `
      <div class="ios-row">
        <div class="ios-row-label">${f.label}</div>
        <div class="ios-row-spacer"></div>
        ${hasOverride ? `<button class="auto-pill" data-auto="${f.id}">Auto</button>` : ""}
        <input type="text" class="numeric-input" id="goal-${f.id}" />
        <div class="ios-row-unit">${f.unit}</div>
      </div>
    `;
  }).join("");
  return `
    <div class="ios-section">
      <div class="ios-section-header">${t("profileScreen.dailyGoals")}</div>
      <div class="ios-section-body">${rows}</div>
      <div class="ios-section-footer">Protein, carbs and fat are calculated from your calorie target unless you set them yourself.</div>
    </div>
  `;
}

function calculatorSectionHtml(goals) {
  return `
    <div class="ios-section">
      <div class="ios-section-header">${t("profileScreen.calculator")}</div>
      <div class="ios-section-body">${calculatorEstimateRowsHtml(goals)}</div>
      <div class="ios-section-footer">Estimate based on the Mifflin-St Jeor equation.</div>
      <div style="margin-top:12px;">
        <button class="btn-bordered" id="use-calculated-target">Use calculated target (${roundDisplay(goals.computedTargetCalories)} kcal)</button>
      </div>
    </div>
  `;
}

function wireDailyGoalsSection(container, profile, goals) {
  for (const f of GOAL_FIELDS) {
    const input = container.querySelector(`#goal-${f.id}`);
    const currentValue = () => {
      const p = store.getProfile();
      return p[f.key] !== null && p[f.key] !== undefined ? p[f.key] : store.computeGoals()[f.derivedKey];
    };
    wireNumericInput(input, {
      getValue: currentValue,
      decimal: f.decimal,
      min: 0,
      max: f.id === "calories" ? 20000 : 2000,
      onCommit: (v) => {
        store.setProfile({ [f.key]: v });
        render(container);
      },
    });

    const autoBtn = container.querySelector(`[data-auto="${f.id}"]`);
    if (autoBtn) {
      autoBtn.addEventListener("click", () => {
        store.setProfile({ [f.key]: null });
        render(container);
      });
    }
  }
}

function wireCalculatorSection(container, goals) {
  const btn = container.querySelector("#use-calculated-target");
  if (btn) {
    btn.addEventListener("click", () => {
      store.setProfile({ customTargetKcal: null });
      render(container);
    });
  }
}
