// login.js — sign in / create account screen. Replaces the bare passcode prompt: people get a
// username they can remember, a password they choose, and a way to change it.
//
// The token returned by /api/auth is a signed session, stored exactly where the old passcode was,
// so every existing call (sync, Gemini, the Us page) keeps working untouched.

import { setStoredToken, getStoredToken } from "../net.js";
import { t } from "../i18n.js";

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export async function postAuth(payload) {
  try {
    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-snapcal-token": getStoredToken() },
      body: JSON.stringify(payload),
    });
    return await res.json();
  } catch (err) {
    return { ok: false, errorType: "network", message: t("errors.offline") };
  }
}

/** True when this device holds a session the server still accepts. */
export async function hasValidSession() {
  if (!getStoredToken()) return false;
  const out = await postAuth({ op: "whoami" });
  return out.ok === true;
}

/**
 * Renders the full-screen login into `container`. Resolves once signed in.
 * @param {{mode?: "login"|"signup"}} opts
 */
export function renderLogin(container, { mode = "login" } = {}) {
  return new Promise((resolve) => {
    let current = mode;
    let busy = false;
    let error = "";

    const draw = () => {
      const isSignup = current === "signup";
      container.innerHTML = `
        <div class="auth-screen">
          <div class="auth-card">
            <div class="auth-brand">SnapCal</div>
            <h1 class="auth-title">${isSignup ? t("auth.createTitle") : t("auth.signInTitle")}</h1>

            <label class="auth-label" for="auth-user">${t("auth.username")}</label>
            <input id="auth-user" class="auth-input" type="text" autocapitalize="none" autocorrect="off"
                   spellcheck="false" autocomplete="username" inputmode="text" />

            <label class="auth-label" for="auth-pass">${t("auth.password")}</label>
            <input id="auth-pass" class="auth-input" type="password"
                   autocomplete="${isSignup ? "new-password" : "current-password"}" />

            ${isSignup ? `
              <label class="auth-label" for="auth-invite">${t("auth.invite")}</label>
              <input id="auth-invite" class="auth-input" type="text" autocapitalize="none" autocorrect="off" />
              <div class="auth-hint">${t("auth.inviteHint")}</div>` : ""}

            ${error ? `<div class="auth-error">${escapeHtml(error)}</div>` : ""}

            <button type="button" class="auth-submit" id="auth-submit" ${busy ? "disabled" : ""}>
              ${busy ? t("auth.working") : isSignup ? t("auth.createButton") : t("auth.signInButton")}
            </button>

            <button type="button" class="auth-switch" id="auth-switch">
              ${isSignup ? t("auth.haveAccount") : t("auth.noAccount")}
            </button>
            ${!isSignup ? `<div class="auth-hint auth-forgot">${t("auth.forgot")}</div>` : ""}
          </div>
        </div>`;

      const userEl = container.querySelector("#auth-user");
      const passEl = container.querySelector("#auth-pass");
      const inviteEl = container.querySelector("#auth-invite");

      const submit = async () => {
        if (busy) return;
        const username = userEl.value.trim().toLowerCase();
        const password = passEl.value;
        if (username === "" || password === "") {
          error = t("auth.fillBoth");
          draw();
          return;
        }
        busy = true;
        error = "";
        draw();

        const out = await postAuth(
          current === "signup"
            ? { op: "signup", username, password, invite: inviteEl?.value.trim() }
            : { op: "login", username, password }
        );
        busy = false;

        if (!out.ok) {
          error = out.message || t("errors.generic");
          draw();
          // keep what they typed rather than making them start again
          container.querySelector("#auth-user").value = username;
          return;
        }
        setStoredToken(out.token);
        resolve({ username, mustChange: out.mustChange === true });
      };

      container.querySelector("#auth-submit").addEventListener("click", submit);
      [userEl, passEl, inviteEl].forEach((el) =>
        el?.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); })
      );
      container.querySelector("#auth-switch").addEventListener("click", () => {
        current = current === "signup" ? "login" : "signup";
        error = "";
        draw();
      });
      userEl.focus();
    };

    draw();
  });
}
