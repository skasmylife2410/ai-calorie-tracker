// push-ui.js — the three places notifications show up in the app:
//   renderPushCard(host)       the "Get notified" card at the top of Us (until on or dismissed)
//   renderPushSettings(host)   the On/Off section in Profile
//   maybeShowWhatsNew()        a one-time "What's new" sheet after an update
// To announce the next update: change WHATS_NEW.id and the whatsNew.* strings in i18n.

import { t } from "../i18n.js";
import { openSheet } from "./sheet.js";
import { pushState, enablePush, disablePush, pushCardDismissed, dismissPushCard, serverKey } from "../push.js";

export const WHATS_NEW = { id: "2026-09-25-notifications", items: ["n1", "n2"] };
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

/** Shows the latest update once per phone (or on demand, e.g. from an announcement tap). */
export async function maybeShowWhatsNew({ force = false } = {}) {
  let seen = null;
  try { seen = localStorage.getItem(SEEN_KEY); } catch {}
  if (!force && seen === WHATS_NEW.id) return;
  // this update is about notifications: wait until the server can actually send them
  if (!(await serverKey())) return;
  try { localStorage.setItem(SEEN_KEY, WHATS_NEW.id); } catch {}
  const state = await pushState();
  openSheet({
    render(panel, close) {
      panel.innerHTML = `
        <div class="whatsnew">
          <h2 class="whatsnew-title">✨ ${t("whatsNew.title")}</h2>
          ${WHATS_NEW.items.map((k) => `
            <div class="whatsnew-item">
              <div class="whatsnew-item-title">${t(`whatsNew.${k}Title`)}</div>
              <p class="whatsnew-item-body">${t(`whatsNew.${k}Body`)}</p>
            </div>`).join("")}
          ${state === "needsInstall" ? `<p class="whatsnew-note">${t("push.installBody")}</p>` : ""}
          <div class="push-actions">
            ${state === "off" ? `<button type="button" class="acct-btn is-primary" data-wn="on">🔔 ${t("push.turnOn")}</button>` : ""}
            <button type="button" class="acct-btn" data-wn="close">${t("whatsNew.close")}</button>
          </div>
        </div>`;
      panel.querySelector('[data-wn="close"]').addEventListener("click", close);
      panel.querySelector('[data-wn="on"]')?.addEventListener("click", async (e) => {
        await turnOn(e.currentTarget);
        close();
      });
    },
  });
}
