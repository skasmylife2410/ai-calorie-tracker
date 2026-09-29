// install-guide.js — "Put SnapCal on your Home Screen": the iPhone / Android steps, in one place
// for the last step of setup, the one-time card on Home and the row in Profile. Hidden once the
// app runs from the Home Screen (install.js isStandalone()).

import { t } from "../i18n.js";
import { isStandalone, platform, canPromptInstall, promptInstall, onInstallChange, SHARE_ICON, ADD_ICON, MENU_ICON, PHONE_ICON } from "../install.js";
import { openSheet, navBar, wireNavBar } from "./sheet.js";

const DISMISS_KEY = "snapcal.installCardDismissed";

/** Which instructions to start on: this phone's, iPhone when we can't tell. */
export const defaultInstallFor = () => (platform() === "android" ? "android" : "ios");

/** The platform switch, Android's one-tap button when Chrome offers it, and the numbered steps. */
export function installGuideHtml(installFor) {
  const ios = installFor === "ios";
  const steps = ios
    ? [t("onb.ios1"), t("onb.ios2", { icon: SHARE_ICON }), t("onb.ios3", { icon: ADD_ICON }), t("onb.ios4")]
    : [t("onb.android1", { icon: MENU_ICON }), t("onb.android2", { icon: PHONE_ICON }), t("onb.android3")];
  const oneTap = !ios && canPromptInstall();
  return `
    <div class="onb-units onb-platform" role="group" aria-label="${t("onb.installWhich")}">
      <button type="button" data-platform="ios" aria-pressed="${ios}">iPhone</button>
      <button type="button" data-platform="android" aria-pressed="${!ios}">Android</button>
    </div>
    ${oneTap ? `<button type="button" class="onb-install-now" id="onb-install-now">${PHONE_ICON}<span>${t("onb.installNow")}</span></button><p class="onb-note">${t("onb.installOrByHand")}</p>` : ""}
    <ol class="onb-install-steps">
      ${steps.map((s, i) => `<li><span class="onb-install-n">${i + 1}</span><span class="onb-install-text">${s}</span></li>`).join("")}
    </ol>
    <p class="onb-note">${ios ? t("onb.iosNote") : t("onb.androidNote")}</p>`;
}

/** Wires the switch and the one-tap button inside `root`. */
export function wireInstallGuide(root, { setFor, redraw, onInstalled }) {
  root.querySelectorAll("[data-platform]").forEach((b) => b.addEventListener("click", () => { setFor(b.dataset.platform); redraw(); }));
  root.querySelector("#onb-install-now")?.addEventListener("click", async () => {
    if (await promptInstall()) onInstalled?.();
    else redraw();
  });
}

/** The same guide as a sheet (from the Home card or Profile). */
export function openInstallSheet() {
  let installFor = defaultInstallFor();
  let stopWatch = null;
  openSheet({
    render(panel, close) {
      const draw = () => {
        panel.innerHTML = `
          ${navBar({ title: t("install.sheetTitle"), leading: { label: t("app.close") } })}
          <div class="sheet-panel-body install-body">
            <p class="onb-sub">${t("onb.installSub")}</p>
            ${installGuideHtml(installFor)}
          </div>`;
        wireNavBar(panel, { onLeading: () => close() });
        wireInstallGuide(panel, { setFor: (v) => { installFor = v; }, redraw: draw, onInstalled: () => { dismissInstallCard(); close(); } });
      };
      draw();
      stopWatch = onInstallChange(draw); // Chrome's install offer can arrive a moment later
    },
    onClosed() { stopWatch?.(); },
  });
}

/** The Home card: only in a browser on a phone, until installed or dismissed. */
export function shouldOfferInstall() {
  if (isStandalone()) return false;
  if (platform() === "other") return false; // a computer: nothing to put on a Home Screen
  try { return localStorage.getItem(DISMISS_KEY) !== "1"; } catch { return false; }
}

export function dismissInstallCard() {
  try { localStorage.setItem(DISMISS_KEY, "1"); } catch { /* private mode */ }
}

export function installCardHtml() {
  return `
    <div class="install-card card" id="install-card">
      <button type="button" class="install-card-go" id="install-card-go">
        <span class="install-card-icon">${PHONE_ICON}</span>
        <span class="install-card-text"><b>${t("install.cardTitle")}</b><span>${t("install.cardSub")}</span></span>
        <span class="install-card-chev" aria-hidden="true">›</span>
      </button>
      <button type="button" class="install-card-x" id="install-card-x" aria-label="${t("install.cardDismiss")}">×</button>
    </div>`;
}

export function wireInstallCard(root, onChange) {
  root.querySelector("#install-card-go")?.addEventListener("click", () => openInstallSheet());
  root.querySelector("#install-card-x")?.addEventListener("click", () => { dismissInstallCard(); onChange?.(); });
}
