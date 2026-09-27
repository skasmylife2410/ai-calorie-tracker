// theme.js — which look the app wears. "mono" (black & white, colour only on markers) is the
// default for everyone; "classic" is the original warm, colourful look, kept one tap away in
// Profile › Appearance. The choice lives on the profile so it travels between this person's
// devices like the language does.
//
// On <html>: data-theme="mono|classic", data-mode="light|dark" (mono only) and
// data-markers="off" when they want pure black & white. js/theme-boot.js sets the same
// attributes before first paint from the stored profile; keep the two in step.

export const THEMES = ["mono-light", "mono-dark", "mono-auto", "classic"];
export const DEFAULT_THEME = "mono-light";

// Page background per look, for the browser / status bar colour.
const CHROME = { light: "#F2F2F2", dark: "#000000" };

/** Resolves a profile to the attributes <html> should carry. Pure, so it's easy to test. */
export function resolveTheme(profile = {}, prefersDark = false) {
  const theme = THEMES.includes(profile.theme) ? profile.theme : DEFAULT_THEME;
  if (theme === "classic") return { theme: "classic", mode: null, markers: true };
  const mode = theme === "mono-dark" || (theme === "mono-auto" && prefersDark) ? "dark" : "light";
  return { theme: "mono", mode, markers: profile.monoMarkers !== false };
}

const darkQuery = () => globalThis.matchMedia?.("(prefers-color-scheme: dark)");

/** Applies the profile's look to the document. Safe to call as often as the profile changes. */
export function applyTheme(profile, doc = globalThis.document) {
  if (!doc) return;
  const { theme, mode, markers } = resolveTheme(profile, Boolean(darkQuery()?.matches));
  const root = doc.documentElement;
  root.dataset.theme = theme;
  if (mode) root.dataset.mode = mode; else delete root.dataset.mode;
  if (markers) delete root.dataset.markers; else root.dataset.markers = "off";
  // classic hands the status bar colour to the sky (js/ui/sky.js); mono sets its own
  if (theme === "mono") doc.querySelector('meta[name="theme-color"]')?.setAttribute("content", CHROME[mode]);
}

/** Re-applies when the phone switches between light and dark (only matters for "mono-auto"). */
export function watchSystemTheme(getProfile) {
  darkQuery()?.addEventListener?.("change", () => applyTheme(getProfile()));
}
