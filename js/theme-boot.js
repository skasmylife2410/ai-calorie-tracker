// theme-boot.js — a tiny blocking script in <head> that puts the right look on <html> before
// anything paints, so a Mono Dark phone never flashes the light theme. Same rules as
// resolveTheme() in js/theme.js; js/app.js re-applies the full version once the app boots.
(function () {
  var p = {};
  try { p = JSON.parse(localStorage.getItem("snapcal.userProfile") || "{}") || {}; } catch (e) { /* private mode */ }
  var t = ["mono-light", "mono-dark", "mono-auto", "classic"].indexOf(p.theme) >= 0 ? p.theme : "mono-light";
  var r = document.documentElement;
  if (t === "classic") { r.setAttribute("data-theme", "classic"); return; }
  var dark = t === "mono-dark" || (t === "mono-auto" && window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches);
  r.setAttribute("data-theme", "mono");
  r.setAttribute("data-mode", dark ? "dark" : "light");
  if (p.monoMarkers === false) r.setAttribute("data-markers", "off");
  var m = document.querySelector('meta[name="theme-color"]');
  if (m) m.setAttribute("content", dark ? "#000000" : "#F2F2F2");
})();
