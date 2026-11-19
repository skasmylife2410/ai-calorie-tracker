// push-ui.js — the three places notifications show up in the app:
//   renderPushCard(host)       the "Get notified" card at the top of Us (until on or dismissed)
//   renderPushSettings(host)   the On/Off section in Profile
//   maybeShowWhatsNew()        a one-time "What's new" sheet after an update
// To announce the next update: change WHATS_NEW.id and the whatsNew.* strings in i18n.

import { t, tIn } from "../i18n.js";
import { openSheet } from "./sheet.js";
import { biteMark, numberedHtml } from "./mark.js";
import { apiFetch } from "../net.js";
import { myGroupsInfo } from "../social.js";
import { pushState, enablePush, disablePush, pushCardDismissed, dismissPushCard, serverKey } from "../push.js";

export const WHATS_NEW = { id: "2026-11-21-boca0", items: ["n1", "n2", "n3"] };
const SEEN_KEY = "snapcal.whatsNewSeen";

function toast(text) {
  const el = document.createElement("div");
  el.className = "push-toast";
  el.textContent = text;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add("visible"));
  setTimeout(() => { el.classList.remove("visible"); setTimeout(() => el.remove(), 300); }, 2600);
}

async function turnOn(button) {
  if (button) { button.disabled = true; button.textContent = "…"; }
  let state;
  try { state = await enablePush(); } catch { state = "failed"; }
  if (state === "on") toast(t("push.enabled"));
  else if (state === "notReady") toast(t("push.notReady"));
  else if (state !== "denied") toast(t("push.failed"));
  return state;
}

/** Us tab: invites people to turn notifications on. Hidden once on, blocked, or dismissed. */
export async function renderPushCard(host) {
  if (!host) return;
  host.innerHTML = "";
  if (pushCardDismissed() || !(await serverKey())) return;
  const state = await pushState();
  if (state === "needsInstall") {
    host.innerHTML = `
      <div class="rc-card push-card">
        <h2 class="rc-title">🔔 ${t("push.installTitle")}</h2>
        <p class="rc-body">${t("push.installBody")}</p>
        <div class="push-actions"><button type="button" class="acct-btn" data-push="dismiss">${t("push.gotIt")}</button></div>
      </div>`;
  } else if (state === "off") {
    host.innerHTML = `
      <div class="rc-card push-card">
        <h2 class="rc-title">🔔 ${t("push.cardTitle")}</h2>
        <p class="rc-body">${t("push.cardBody")}</p>
        <div class="push-actions">
          <button type="button" class="acct-btn" data-push="dismiss">${t("push.notNow")}</button>
          <button type="button" class="acct-btn is-primary" data-push="on">${t("push.turnOn")}</button>
        </div>
      </div>`;
  } else {
    return;
  }
  host.querySelector('[data-push="dismiss"]')?.addEventListener("click", () => { dismissPushCard(); host.innerHTML = ""; });
  host.querySelector('[data-push="on"]')?.addEventListener("click", async (e) => {
    const state2 = await turnOn(e.currentTarget);
    if (state2 === "on" || state2 === "denied") host.innerHTML = "";
    else renderPushCard(host);
  });
}

/** Profile: On/Off for this phone, with a line that explains the current situation. */
export async function renderPushSettings(host) {
  if (!host) return;
  const state = await pushState();
  const canToggle = state === "on" || state === "off";
  const hint = { on: "hintOn", off: "hintOff", denied: "hintDenied", needsInstall: "hintInstall", unsupported: "hintUnsupported" }[state] ?? "hintOff";
  host.innerHTML = `
    <div class="ios-section-header">${t("push.settingsTitle")}</div>
    ${canToggle ? `
    <div class="ios-section-body">
      <div class="lang-row">
        <button type="button" class="lang-btn${state === "on" ? " is-on" : ""}" data-pushset="on">${t("push.on")}</button>
        <button type="button" class="lang-btn${state === "off" ? " is-on" : ""}" data-pushset="off">${t("push.off")}</button>
      </div>
    </div>` : ""}
    <div class="ios-section-footer">${t(`push.${hint}`)}</div>`;
  host.querySelectorAll("[data-pushset]").forEach((b) => b.addEventListener("click", async () => {
    if (b.dataset.pushset === state) return;
    if (b.dataset.pushset === "on") await turnOn(b);
    else await disablePush();
    renderPushSettings(host);
  }));
}

/**
 * Whether this phone used the app before this update: the "SnapCal is now Boca0" news means
 * nothing to someone who has just signed up.
 */
export function usedBefore(storage = globalThis.localStorage, since = Date.parse("2026-11-20T00:00:00Z")) {
  try {
    if (storage.getItem(SEEN_KEY)) return true;
    const meals = JSON.parse(storage.getItem("snapcal.foodEntries") || "[]");
    return meals.some((m) => Number(m?.timestamp) < since);
  } catch {
    return false;
  }
}

async function announce() {
  const pick = (k) => ({ en: tIn("en", k), es: tIn("es", k) });
  try {
    const res = await apiFetch("/api/notes", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op: "announce", title: pick("whatsNew.pushTitle"), body: pick("whatsNew.pushBody") }) });
    return await res.json();
  } catch {
    return { ok: false };
  }
}

/** Shows the latest update once per phone (or on demand, e.g. from an announcement tap). */
export async function maybeShowWhatsNew({ force = false } = {}) {
  let seen = null;
  try { seen = localStorage.getItem(SEEN_KEY); } catch {}
  if (!force && seen === WHATS_NEW.id) return;
  if (!force && !usedBefore()) { try { localStorage.setItem(SEEN_KEY, WHATS_NEW.id); } catch {} return; }
  try { localStorage.setItem(SEEN_KEY, WHATS_NEW.id); } catch {}
  const groups = await myGroupsInfo().catch(() => ({}));
  openSheet({
    render(panel, close) {
      panel.innerHTML = `
        <div class="wn">
          <span class="wn-mark">${biteMark(44)}</span>
          <h2 class="wn-title">${t("whatsNew.title")}</h2>
          <p class="wn-sub">${t("whatsNew.sub")}</p>
          ${numberedHtml(WHATS_NEW.items.map((k) => [t(`whatsNew.${k}Title`), t(`whatsNew.${k}Body`)]))}
          <div class="wn-actions">
            <button type="button" class="acct-btn is-primary" data-wn="try">${t("whatsNew.try")}</button>
            <button type="button" class="wn-plain" data-wn="close">${t("whatsNew.close")}</button>
            ${groups?.isAdmin ? `<button type="button" class="wn-admin" data-wn="notify">${t("whatsNew.notify")}</button>` : ""}
          </div>
        </div>`;
      panel.querySelector('[data-wn="close"]').addEventListener("click", close);
      panel.querySelector('[data-wn="try"]').addEventListener("click", () => { close(); globalThis.snapcalGoTo?.("us"); });
      panel.querySelector('[data-wn="notify"]')?.addEventListener("click", async (e) => {
        if (!confirm(t("whatsNew.notifyAsk"))) return;
        const b = e.currentTarget;
        b.disabled = true;
        const out = await announce();
        b.textContent = out.ok ? t("whatsNew.notified", { n: out.sent ?? 0 }) : t("whatsNew.notifyFailed");
        b.disabled = Boolean(out.ok);
      });
    },
  });
}
