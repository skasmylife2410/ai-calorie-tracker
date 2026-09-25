// passcode.js — minimal passcode gate prompt, shown once on any 401 from /api/* (net.js). Reuses
// the standard sheet shell so it matches the rest of the app; nothing else about the UI changes.

import { openSheet, navBar, wireNavBar } from "./sheet.js";
import { setStoredToken } from "../net.js";
import { t } from "../i18n.js";

/**
 * @param {boolean} [showError] show an "incorrect passcode" line (a previous attempt just failed)
 * @returns {Promise<boolean>} true if the user submitted a candidate passcode, false if cancelled
 */
export function openPasscodeSheet(showError = false) {
  return new Promise((resolve) => {
    let settled = false;

    openSheet({
      render(panel, close) {
        panel.innerHTML = `
          ${navBar({
            title: t("ui.passcode"),
            leading: { label: t("app.cancel") },
            trailing: { label: t("ui.continue"), bold: true, disabled: true },
          })}
          <div class="sheet-panel-body">
            <div class="describe-body">
              <div class="describe-subhead">Enter the app passcode to continue.</div>
              <input type="password" class="numeric-input" id="passcode-input" autocomplete="off" style="width:100%;" />
              ${showError ? `<div class="describe-footer-tip" style="color:var(--sc-red);">Incorrect passcode — try again.</div>` : ""}
            </div>
          </div>
        `;

        const input = panel.querySelector("#passcode-input");
        const continueBtn = panel.querySelector('[data-nav="trailing"]');

        const submit = () => {
          if (settled || input.value.trim() === "") return;
          settled = true;
          setStoredToken(input.value.trim());
          close();
          resolve(true);
        };

        input.addEventListener("input", () => {
          continueBtn.disabled = input.value.trim() === "";
        });
        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter") submit();
        });

        wireNavBar(panel, {
          onLeading: () => close(),
          onTrailing: submit,
        });

        setTimeout(() => input.focus(), 350);
      },
      onClosed: () => {
        if (!settled) {
          settled = true;
          resolve(false);
        }
      },
    });
  });
}
