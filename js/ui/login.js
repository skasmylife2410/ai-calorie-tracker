// login.js — sign in / create account screen. Replaces the bare passcode prompt: people get a
// username they can remember, a password they choose, and a way to change it.
//
// The token returned by /api/auth is a signed session, stored exactly where the old passcode was,
// so every existing call (sync, Gemini, the Us page) keeps working untouched.

import { setStoredToken, getStoredToken } from "../net.js";
import { t, currentLanguage } from "../i18n.js";

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

/** The token from a password-reset email link (?reset=...), if the app was opened from one. */
export function resetLinkToken() {
  return new URLSearchParams(location.search).get("reset") || "";
}

/** True when this device holds a session the server still accepts. */
export async function hasValidSession() {
  // A reset link always goes to the reset screen, even on a phone that is still signed in.
  if (resetLinkToken()) return false;
  if (!getStoredToken()) return false;
  const out = await postAuth({ op: "whoami" });
  if (!out.ok && out.errorType === "unauthorized") {
    // stale session (e.g. the account was renamed): clear it so the sign-in screen appears
    setStoredToken("");
    try { localStorage.removeItem("snapcal.username"); } catch { /* private mode */ }
    return false;
  }
  if (out.ok && out.username) {
    try { localStorage.setItem("snapcal.username", out.username); } catch { /* private mode */ }
  }
  return out.ok === true;
}

/**
 * Renders the full-screen login into `container`. Resolves once signed in.
 * @param {{mode?: "login"|"signup"}} opts
 */
export function renderLogin(container, { mode = "login" } = {}) {
  // Arriving from an invite link (?invite=CODE): go straight to sign-up with the code filled in.
  const linkCode = new URLSearchParams(location.search).get("invite");
  if (linkCode) mode = "signup";
  let linkProblem = null;
  if (linkCode) {
    fetch("/api/invites", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "check", code: linkCode }) })
      .then((r) => r.json())
      .then((out) => { if (out.ok && !out.valid) { linkProblem = out.reason; const el = container.querySelector("#auth-link-msg"); if (el) el.textContent = t(`invite.bad.${out.reason}`); } })
      .catch(() => {});
  }
  const resetToken = resetLinkToken();
  if (resetToken) mode = "reset";
  return new Promise((resolve) => {
    let current = mode;
    let busy = false;
    let error = "";
    let notice = "";

    const signedIn = (token, username) => {
      setStoredToken(token);
      try { localStorage.setItem("snapcal.username", username); } catch { /* private mode */ }
      if (linkCode || resetToken) history.replaceState(null, "", location.pathname);
      resolve({ username, mustChange: false });
    };

    /** "Forgot password?" and "choose a new password" (from the emailed link). */
    const drawRecovery = () => {
      const isReset = current === "reset";
      container.innerHTML = `
        <div class="auth-screen">
          <div class="auth-card">
            <div class="auth-brand">SnapCal</div>
            <h1 class="auth-title">${isReset ? t("auth.resetTitle") : t("auth.forgotTitle")}</h1>
            <div class="auth-sub">${isReset ? t("auth.resetSub") : t("auth.forgotSub")}</div>
            ${isReset ? `
              <label class="auth-label" for="auth-new">${t("auth.newPassword")}</label>
              <input id="auth-new" class="auth-input" type="password" autocomplete="new-password" />
              <label class="auth-label" for="auth-new2">${t("auth.repeatPassword")}</label>
              <input id="auth-new2" class="auth-input" type="password" autocomplete="new-password" />` : `
              <label class="auth-label" for="auth-id">${t("auth.userOrEmail")}</label>
              <input id="auth-id" class="auth-input" type="text" autocapitalize="none" autocorrect="off" spellcheck="false" autocomplete="username" />`}
            ${error ? `<div class="auth-error">${escapeHtml(error)}</div>` : ""}
            ${notice ? `<div class="auth-notice">${escapeHtml(notice)}</div>` : ""}
            ${notice && !isReset ? "" : `<button type="button" class="auth-submit" id="auth-submit" ${busy ? "disabled" : ""}>
              ${busy ? t("auth.working") : isReset ? t("auth.resetButton") : t("auth.sendLink")}
            </button>`}
            <button type="button" class="auth-switch" id="auth-back">${t("auth.backToSignIn")}</button>
          </div>
        </div>`;

      const submit = async () => {
        if (busy) return;
        let payload;
        if (isReset) {
          const a = container.querySelector("#auth-new").value;
          const b = container.querySelector("#auth-new2").value;
          if (a.length < 8) { error = t("auth.tooShort"); drawRecovery(); return; }
          if (a !== b) { error = t("auth.noMatch"); drawRecovery(); return; }
          payload = { op: "reset", token: resetToken, newPassword: a };
        } else {
          const identifier = container.querySelector("#auth-id").value.trim();
          if (!identifier) { error = t("auth.userOrEmail"); drawRecovery(); return; }
          payload = { op: "forgot", identifier, lang: currentLanguage() === "es" ? "es" : "en" };
        }
        busy = true; error = ""; drawRecovery();
        const out = await postAuth(payload);
        busy = false;
        if (!out.ok) { error = out.message || t("errors.generic"); drawRecovery(); return; }
        if (isReset) return signedIn(out.token, out.username);
        notice = t("auth.linkSent");
        drawRecovery();
      };

      container.querySelector("#auth-submit")?.addEventListener("click", submit);
      container.querySelectorAll(".auth-input").forEach((el) => el.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); }));
      container.querySelector("#auth-back").addEventListener("click", () => {
        if (resetToken) history.replaceState(null, "", location.pathname);
        current = "login"; error = ""; notice = ""; draw();
      });
      container.querySelector(".auth-input")?.focus();
    };

    const draw = () => {
      if (current === "forgot" || (current === "reset" && resetLinkToken())) return drawRecovery();
      const isSignup = current === "signup";
      container.innerHTML = `
        <div class="auth-screen">
          <div class="auth-card">
            <div class="auth-brand">SnapCal</div>
            <h1 class="auth-title">${isSignup && linkCode ? t("invite.joinTitle") : isSignup ? t("auth.createTitle") : t("auth.signInTitle")}</h1>
            ${isSignup && linkCode ? `<div class="auth-sub">${t("invite.joinSub")}</div><div class="auth-error" id="auth-link-msg">${linkProblem ? t(`invite.bad.${linkProblem}`) : ""}</div>` : ""}

            <label class="auth-label" for="auth-user">${t("auth.username")}</label>
            <input id="auth-user" class="auth-input" type="text" autocapitalize="none" autocorrect="off"
                   spellcheck="false" autocomplete="username" inputmode="text" />

            <label class="auth-label" for="auth-pass">${t("auth.password")}</label>
            <input id="auth-pass" class="auth-input" type="password"
                   autocomplete="${isSignup ? "new-password" : "current-password"}" />

            ${isSignup && !linkCode ? `
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
            ${!isSignup ? `<button type="button" class="auth-switch auth-forgot" id="auth-forgot">${t("auth.forgotLink")}</button>` : ""}
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
            ? { op: "signup", username, password, invite: linkCode || inviteEl?.value.trim() }
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
        try { localStorage.setItem("snapcal.username", username); } catch { /* private mode */ }
        if (linkCode) history.replaceState(null, "", location.pathname);
        resolve({ username, mustChange: out.mustChange === true });
      };
      container.querySelector("#auth-forgot")?.addEventListener("click", () => {
        current = "forgot"; error = ""; notice = ""; draw();
      });

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
