// net.js — shared helper for calling this app's own /api/* endpoints with the session header
// (x-snapcal-token) attached, and sending people back to sign-in when the server refuses it.

const TOKEN_KEY = "snapcal.apiToken";

export function getStoredToken() {
  try {
    return globalThis.localStorage?.getItem(TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

export function setStoredToken(token) {
  try {
    if (token) globalThis.localStorage?.setItem(TOKEN_KEY, token);
    else globalThis.localStorage?.removeItem(TOKEN_KEY);
  } catch {
    // best-effort only
  }
}

const ENDED_KEY = "snapcal.sessionEnded";

/** True once, right after the server stopped accepting this phone's sign-in (login.js says why). */
export function takeSessionEnded() {
  try {
    const was = globalThis.sessionStorage?.getItem(ENDED_KEY) === "1";
    globalThis.sessionStorage?.removeItem(ENDED_KEY);
    return was;
  } catch {
    return false;
  }
}

let ending = false;
/**
 * The server refused this phone's session (the password was changed or reset, the account was
 * removed, or an old session ran out): back to the sign-in screen. Meals saved on the phone stay
 * and sync once they sign in again. This used to open the old shared-passcode prompt from before
 * accounts, which asked people for a "passcode" they never had and saved whatever they typed in
 * place of their session.
 */
function sessionEnded() {
  if (ending) return;
  ending = true;
  setStoredToken("");
  try { globalThis.sessionStorage?.setItem(ENDED_KEY, "1"); } catch { /* private mode */ }
  globalThis.location?.reload();
}

/**
 * Fetches a same-origin /api/* endpoint with this phone's session (x-snapcal-token). A 401 means
 * the session is no longer valid: the app goes back to sign-in, and the 401 is returned so the
 * caller treats it like any other failed request.
 */
export async function apiFetch(url, options = {}) {
  const token = getStoredToken();
  const headers = { ...(options.headers || {}), "x-snapcal-token": token };
  const res = await fetch(url, { ...options, headers });
  // only a session that was sent can have ended (no token: the sign-in screen is already showing)
  if (res.status === 401 && token) sessionEnded();
  return res;
}
