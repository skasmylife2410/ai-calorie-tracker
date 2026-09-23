// profile.js — Profile / Settings tab (ProfileSettingsView in ContentView.swift), SPEC-UI.md §3.

import * as store from "../store.js";
import * as sync from "../sync.js";
import { t, currentLanguage, setLanguage, supportedLanguages } from "../i18n.js";
import { postAuth } from "./login.js";
import { nanoFailure } from "./nano-doodle.js";
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
    <div class="navbar">
      <button type="button" class="navbar-btn" id="profile-back">‹ ${t("tabs.home")}</button>
      <div class="navbar-title">${t("tabs.profile")}</div>
      <span class="navbar-spacer"></span>
    </div>
    <div class="ios-form">
      ${dailyGoalsSectionHtml(profile, goals)}
      <div class="ios-caption-block">These aren't required — only used if you want SnapCal to estimate your target for you.</div>
      ${bodyStatsSectionHtml(profile)}
      ${activityLevelSectionHtml(profile)}
      ${goalSectionHtml(profile)}
      ${goals.hasValidStats ? calculatorSectionHtml(goals) : ""}
      ${suggestSectionHtml()}
      ${redoSectionHtml()}
      <div class="ios-section">
        <div class="ios-section-header">${t("displayName.title")}</div>
        <div class="ios-section-body">
          <div class="ios-row">
            <input type="text" class="numeric-input name-input" id="display-name" maxlength="40"
                   placeholder="${t("displayName.placeholder")}" value="${escapeHtml(profile.displayName ?? "")}" />
          </div>
        </div>
        <div class="ios-section-footer">${t("displayName.hint")}</div>
      </div>
      ${accountSectionHtml(currentUsername)}
      ${membersSectionHtml()}
      ${inviteSectionHtml()}
      ${accuracySectionHtml(profile)}
      ${scanQualityHtml(profile)}
      ${doodlePickHtml()}
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
  container.querySelector("#profile-back")?.addEventListener("click", () => globalThis.snapcalGoTo?.("home"));
  wireAccount(container, currentUsername);
  wireInvites(container);
  wireMembers(container, currentUsername);
  wireRedo(container);
  wireSuggest(container);
  const nameInput = container.querySelector("#display-name");
  nameInput?.addEventListener("change", () => store.setProfile({ displayName: nameInput.value.trim().slice(0, 40) || null }));
  container.querySelectorAll("[data-scanq]").forEach((b) =>
    b.addEventListener("click", () => { store.setProfile({ scanQuality: b.dataset.scanq }); render(container); })
  );
  container.querySelectorAll("[data-excredit]").forEach((b) =>
    b.addEventListener("click", () => { store.setProfile({ exerciseCreditPct: Number(b.dataset.excredit) }); render(container); })
  );
  container.querySelectorAll("[data-learn]").forEach((b) =>
    b.addEventListener("click", () => { store.setProfile({ useLearnedTdee: b.dataset.learn === "on" }); render(container); })
  );
  container.querySelectorAll("[data-doodle]").forEach((b) =>
    b.addEventListener("click", () => { store.setProfile({ doodleVariant: b.dataset.doodle }); render(container); })
  );
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

/** Suggestion box: everyone can write; the owner sees them all. */
function suggestSectionHtml() {
  return `<div class="ios-section" id="suggest-section"></div>`;
}

async function wireSuggest(container) {
  const host = container.querySelector("#suggest-section");
  if (!host) return;
  const { apiFetch } = await import("../net.js");
  const call = async (body) => {
    try {
      const r = await apiFetch("/api/suggestions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      return await r.json();
    } catch { return { ok: false, message: t("errors.offline") }; }
  };
  const draw = async (msg = "") => {
    const info = await call({ op: "list" });
    const list = info.ok ? info.suggestions : [];
    host.innerHTML = `
      <div class="ios-section-header">${t("suggest.title")}</div>
      <div class="ios-section-body">
        <textarea class="sug-input" id="sug-input" rows="3" maxlength="600" placeholder="${t("suggest.placeholder")}"></textarea>
        <div class="acct-actions"><button type="button" class="acct-btn" id="sug-send">${t("suggest.button")}</button></div>
        ${msg ? `<div class="acct-msg">${msg}</div>` : ""}
        ${list.length ? `<div class="inv-head">${info.isAdmin ? t("suggest.all") : t("suggest.yours")}</div>` : ""}
        ${list.map((x) => `
          <div class="sug-row${x.done ? " is-done" : ""}">
            <div class="sug-body">${info.isAdmin ? `<b>${x.owner}</b> · ` : ""}${escapeHtml(x.body)}</div>
            ${info.isAdmin && !x.done ? `<button type="button" class="sug-done" data-done="${x.id}">${t("suggest.done")}</button>` : ""}
          </div>`).join("")}
      </div>
      <div class="ios-section-footer">${t("suggest.hint")}</div>`;
    host.querySelector("#sug-send")?.addEventListener("click", async () => {
      const input = host.querySelector("#sug-input");
      if (!input.value.trim()) return;
      const out = await call({ op: "send", body: input.value });
      draw(out.ok ? t("suggest.sent") : out.message || t("errors.generic"));
    });
    host.querySelectorAll("[data-done]").forEach((b) => b.addEventListener("click", async () => { await call({ op: "done", id: b.dataset.done }); draw(); }));
  };
  draw();
}

function escapeHtml(x) {
  return String(x).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/** Redo the first-run questions, keeping all logged data. */
function redoSectionHtml() {
  return `
    <div class="ios-section">
      <div class="ios-section-header">${t("redo.title")}</div>
      <div class="ios-section-body">
        <div class="acct-actions"><button type="button" class="acct-btn" id="redo-setup">${t("redo.button")}</button></div>
      </div>
      <div class="ios-section-footer">${t("redo.hint")}</div>
    </div>`;
}

function wireRedo(container) {
  container.querySelector("#redo-setup")?.addEventListener("click", async () => {
    const { render: renderOnboarding } = await import("./onboarding.js");
    const overlay = document.createElement("div");
    overlay.className = "setup-overlay";
    overlay.innerHTML = `
      <div class="setup-bar">
        <button type="button" class="setup-cancel" id="setup-cancel">${t("app.cancel")}</button>
        <div class="setup-title">${t("redo.title")}</div>
        <span class="navbar-spacer"></span>
      </div>
      <div class="setup-body scroll-view" id="setup-body"></div>`;
    document.body.appendChild(overlay);
    document.body.classList.add("setup-open"); // stop the page behind from scrolling

    const close = () => {
      overlay.remove();
      document.body.classList.remove("setup-open");
    };
    overlay.querySelector("#setup-cancel").addEventListener("click", close);

    renderOnboarding(overlay.querySelector("#setup-body"), () => {
      close();
      globalThis.snapcalGoTo?.("home"); // straight back to the app with the new numbers
    }, { redo: true });
  });
}

/** Members and their groups (owner only): fixes anyone who signed up without a group. */
function membersSectionHtml() {
  return `<div class="ios-section" id="members-section"></div>`;
}

async function wireMembers(container, me) {
  const host = container.querySelector("#members-section");
  if (!host) return;
  const { apiFetch } = await import("../net.js");
  const call = async (body) => {
    try {
      const r = await apiFetch("/api/groups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      return await r.json();
    } catch { return { ok: false }; }
  };
  const draw = async (data) => {
    const info = data ?? (await call({ op: "all" }));
    if (!info.ok || !info.isAdmin) { host.remove(); return; }
    host.innerHTML = `
      <div class="ios-section-header">${t("members.title")}</div>
      <div class="ios-section-body">
        ${info.people.map((p) => `
          <div class="mem-row">
            <span class="mem-name">${p.username}${p.username === me ? ` <i>${t("members.you")}</i>` : ""}</span>
            <span class="mem-groups">
              ${info.groups.map((g) => `
                <button type="button" class="mem-chip${p.groups.includes(g.id) ? " is-on" : ""}"
                        data-user="${p.username}" data-group="${g.id}" data-member="${p.groups.includes(g.id) ? "0" : "1"}">${g.name}</button>`).join("")}
            </span>
            ${p.groups.length === 0 ? `<span class="mem-warn">${t("members.none")}</span>` : ""}
          </div>`).join("")}
      </div>
      <div class="ios-section-footer">${t("members.hint")}</div>`;
    host.querySelectorAll(".mem-chip").forEach((b) => b.addEventListener("click", async () => {
      b.disabled = true;
      const out = await call({ op: "set", username: b.dataset.user, group: b.dataset.group, member: b.dataset.member === "1" });
      draw(out.ok ? out : undefined);
    }));
  };
  draw();
}

/** Invite people (only shown to the owner): places used, a button to make a link, open links. */
function inviteSectionHtml() {
  return `<div class="ios-section" id="invite-section"></div>`;
}

async function wireInvites(container) {
  const host = container.querySelector("#invite-section");
  if (!host) return;
  const { apiFetch } = await import("../net.js");
  const call = async (body) => {
    try {
      const r = await apiFetch("/api/invites", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      return await r.json();
    } catch { return { ok: false, message: t("errors.offline") }; }
  };
  const draw = async (msg = "") => {
    const info = await call({ op: "list" });
    if (!info.ok || !info.isAdmin) { host.remove(); return; }
    const full = info.members + info.invites.length >= info.max;
    host.innerHTML = `
      <div class="ios-section-header">${t("invite.title")}</div>
      <div class="ios-section-body">
        <div class="ios-row"><div class="ios-row-label">${t("invite.places", { used: info.members, max: info.max })}</div></div>
        <div class="acct-actions"><button type="button" class="acct-btn inv-create" id="inv-create" ${full ? "disabled" : ""}>＋ ${t("invite.create")}</button></div>
        ${info.invites.length ? `
          <div class="inv-head">${t("invite.open")}</div>
          ${info.invites.map((i) => `
            <div class="inv-row">
              <span class="inv-group">${(info.groups ?? []).find((g) => g.id === i.group_id)?.name ?? ""}</span>
              <span class="inv-code">…${i.code.slice(-6)}</span>
              <span class="inv-exp">${t("invite.expires", { date: new Date(i.expires_at).toLocaleDateString() })}</span>
              <button type="button" class="inv-copy" data-copy="${i.code}">⧉</button>
              <button type="button" class="inv-cancel" data-revoke="${i.code}">${t("invite.cancel")}</button>
            </div>`).join("")}` : ""}
        ${msg ? `<div class="acct-msg">${msg}</div>` : ""}
      </div>
      <div class="ios-section-footer">${full ? t("invite.full") : t("invite.hint")}</div>`;

    const linkFor = (code) => `${location.origin}/?invite=${code}`;
    const hand = async (code) => {
      const url = linkFor(code);
      // the phone's share sheet (WhatsApp, Messages…) when there is one, else copy
      if (navigator.share) {
        try { await navigator.share({ text: `${t("invite.shareText")} ${url}` }); return ""; } catch { /* dismissed: fall through to copy */ }
      }
      try { await navigator.clipboard.writeText(url); } catch { /* old browsers */ }
      return t("invite.copied");
    };
    host.querySelector("#inv-create")?.addEventListener("click", async () => {
      const groups = info.groups ?? [];
      // Ask which group the newcomer joins — the whole point of having groups.
      const chosen = groups.length > 1 ? await askGroup(host, groups) : groups[0]?.id ?? null;
      if (!chosen) return draw();
      const made = await call({ op: "create", group: chosen });
      if (!made.ok) return draw(made.message || t("errors.generic"));
      draw(await hand(made.code));
    });
    host.querySelectorAll("[data-copy]").forEach((b) => b.addEventListener("click", async () => draw(await hand(b.dataset.copy))));
    host.querySelectorAll("[data-revoke]").forEach((b) => b.addEventListener("click", async () => { await call({ op: "revoke", code: b.dataset.revoke }); draw(); }));
  };
  draw();
}

/** Little inline picker: which group is this invite for? */
function askGroup(host, groups) {
  return new Promise((resolve) => {
    const box = document.createElement("div");
    box.className = "inv-pick";
    box.innerHTML = `<div class="inv-pick-title">${t("groups.inviteTo")}</div>
      <div class="inv-pick-row">
        ${groups.map((g) => `<button type="button" class="lang-btn" data-pick="${g.id}">${g.name}</button>`).join("")}
      </div>
      <button type="button" class="inv-pick-cancel" data-pick="">${t("groups.cancel")}</button>`;
    host.querySelector(".ios-section-body")?.appendChild(box);
    box.querySelectorAll("[data-pick]").forEach((b) => b.addEventListener("click", () => { box.remove(); resolve(b.dataset.pick || null); }));
  });
}

/** Photo quality: what each scan costs to analyse and store. */
function scanQualityHtml(profile) {
  const current = ["tiny", "saver", "standard"].includes(profile.scanQuality) ? profile.scanQuality : "saver";
  return `
    <div class="ios-section">
      <div class="ios-section-header">${t("scanq.title")}</div>
      <div class="ios-section-body">
        ${["tiny", "saver", "standard"].map((k) => `
          <button type="button" class="onb-choice scanq-choice${k === current ? " is-on" : ""}" data-scanq="${k}">
            <span class="onb-choice-label">${t(`scanq.${k}`)}</span>
            <span class="onb-choice-sub">${t(`scanq.sub.${k}`)}</span>
          </button>`).join("")}
      </div>
      <div class="ios-section-footer">${t("scanq.hint")}</div>
    </div>`;
}

/** Accuracy settings: whether exercise is eaten back, and whether to use learned maintenance. */
function accuracySectionHtml(profile) {
  const pct = [0, 25, 50].includes(Number(profile.exerciseCreditPct)) ? Number(profile.exerciseCreditPct) : 0;
  const learnOn = profile.useLearnedTdee !== false;
  return `
    <div class="ios-section">
      <div class="ios-section-header">${t("accuracy.exTitle")}</div>
      <div class="ios-section-body">
        <div class="lang-row">
          ${[0, 25, 50].map((v) => `<button type="button" class="lang-btn${v === pct ? " is-on" : ""}" data-excredit="${v}">${t(`accuracy.ex${v}`)}</button>`).join("")}
        </div>
      </div>
      <div class="ios-section-footer">${t("accuracy.exHint")}</div>
    </div>
    <div class="ios-section">
      <div class="ios-section-header">${t("accuracy.learnTitle")}</div>
      <div class="ios-section-body">
        <div class="lang-row">
          <button type="button" class="lang-btn${learnOn ? " is-on" : ""}" data-learn="on">${t("accuracy.learnOn")}</button>
          <button type="button" class="lang-btn${!learnOn ? " is-on" : ""}" data-learn="off">${t("accuracy.learnOff")}</button>
        </div>
      </div>
      <div class="ios-section-footer">${t("accuracy.learnHint")}</div>
    </div>`;
}

/** Which doodle: sets the drawing (hair) and the pronoun in its messages. */
function doodlePickHtml() {
  const v = store.getProfile().doodleVariant === "b" ? "b" : "a";
  return `
    <div class="ios-section">
      <div class="ios-section-header">${t("doodlePick.title")}</div>
      <div class="ios-section-body">
        <div class="lang-row">
          <button type="button" class="lang-btn${v === "a" ? " is-on" : ""}" data-doodle="a">${t("doodlePick.boy")}</button>
          <button type="button" class="lang-btn${v === "b" ? " is-on" : ""}" data-doodle="b">${t("doodlePick.girl")}</button>
        </div>
      </div>
      <div class="ios-section-footer">${t("doodlePick.hint")}${nanoFailure()?.errorType === "billing" ? `<br><br>${t("doodlePick.needsBilling")}` : ""}</div>
    </div>`;
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
