// boot-guard.js — a plain (non-module) script in <head> that watches the app start. If the app
// hasn't drawn anything after a few seconds, it replaces the blank page with a short message,
// a "Try again" and a "Repair" button (clears the cached app files, never the person's data),
// and sends the error text to the server (api/auth.js op "clientError") so it can be fixed
// without the phone in hand. Written in old-style JavaScript on purpose: it has to run even on
// a phone whose browser can't run the app's modules.
(function () {
  var errors = [];
  var shown = false;
  var reported = false;
  var began = Date.now();

  function note(text) {
    if (!text) return;
    text = String(text).slice(0, 600);
    if (errors.indexOf(text) < 0 && errors.length < 8) errors.push(text);
  }

  window.addEventListener("error", function (e) {
    var t = e && e.target;
    if (t && t !== window && (t.src || t.href)) {
      note("load failed: " + (t.src || t.href)); // a script or stylesheet that didn't arrive
      if (!failedScript && t.tagName === "SCRIPT") failedScript = t.src;
      return;
    }
    var where = e && e.filename ? " @ " + String(e.filename).replace(location.origin, "") + ":" + e.lineno + ":" + e.colno : "";
    var stack = e && e.error && e.error.stack ? "\n" + String(e.error.stack).split("\n").slice(0, 4).join("\n") : "";
    note((e && e.message ? e.message : "error") + where + stack);
  }, true);

  window.addEventListener("unhandledrejection", function (e) {
    var r = e && e.reason;
    var stack = r && r.stack ? "\n" + String(r.stack).split("\n").slice(0, 4).join("\n") : "";
    note("unhandled: " + (r && r.message ? r.message : String(r)) + stack);
  });

  function drawn() {
    var root = document.getElementById("app-root");
    return !!(root && root.children.length);
  }

  function token() {
    try { return localStorage.getItem("snapcal.apiToken") || ""; } catch (e) { return ""; }
  }

  function spanish() {
    try {
      var p = JSON.parse(localStorage.getItem("snapcal.userProfile") || "{}") || {};
      if (p.language) return p.language === "es";
    } catch (e) { /* ignore */ }
    return /^es/i.test(navigator.language || "");
  }

  var failedScript = null;

  function device() {
    var ua = navigator.userAgent || "";
    var os = ua.match(/(?:iPhone|CPU) OS (\d+[._]\d+)/) || ua.match(/Android (\d+(?:\.\d+)?)/) || ua.match(/Mac OS X (\d+[._]\d+)/);
    var ver = ua.match(/Version\/(\d+\.\d+)/);
    return (os ? (/iPhone|CPU/.test(ua) ? "iOS " : /Android/.test(ua) ? "Android " : "macOS ") + os[1].replace("_", ".") : "") + (ver ? " · Safari " + ver[1] : "") +
      (navigator.standalone ? " · home screen" : "");
  }

  // "load failed" is all Safari says when a module script won't run. Importing the same file
  // again makes the browser tell us the real reason: a syntax it doesn't know, a file that
  // didn't arrive, a wrong content type. If the import succeeds the app simply starts.
  function probe(url) {
    try {
      return import(url).then(function () { return "probe: import ok"; }, function (e) {
        return "probe: " + (e && e.name ? e.name + ": " : "") + (e && e.message ? e.message : String(e));
      });
    } catch (e) {
      return Promise.resolve("probe unavailable: " + (e && e.message ? e.message : String(e)));
    }
  }

  function report() {
    if (reported) return;
    reported = true;
    var msg = (errors.length ? errors.join("\n---\n") : "app did not draw (no error caught)") +
      "\n[" + device() + " · after " + Math.round((Date.now() - began) / 1000) + "s · sw=" + (navigator.serviceWorker && navigator.serviceWorker.controller ? "yes" : "no") + "]";
    try {
      fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-snapcal-token": token() },
        body: JSON.stringify({ op: "clientError", message: msg }),
      }).catch(function () {});
    } catch (e) { /* diagnostics only */ }
  }

  function repair() {
    var jobs = [];
    try {
      if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
        jobs.push(navigator.serviceWorker.getRegistrations().then(function (regs) {
          return Promise.all(regs.map(function (r) { return r.unregister(); }));
        }));
      }
      if (window.caches && caches.keys) {
        jobs.push(caches.keys().then(function (keys) {
          return Promise.all(keys.map(function (k) { return caches.delete(k); }));
        }));
      }
    } catch (e) { /* carry on to the reload */ }
    var go = function () { location.replace("/?fresh=" + Date.now()); };
    Promise.all(jobs).then(go, go);
    setTimeout(go, 3000);
  }

  function show() {
    if (shown || drawn()) return;
    shown = true;
    report();
    var es = spanish();
    var box = document.createElement("div");
    box.id = "boot-rescue";
    box.setAttribute("role", "alert");
    box.style.cssText = "position:fixed;inset:0;z-index:10001;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:24px;text-align:center;background:#F2F2F2;color:#000;font:16px/1.4 -apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif";
    var btn = "font:inherit;font-weight:600;padding:12px 22px;border-radius:999px;border:0;min-width:200px;";
    box.innerHTML =
      "<div style=\"font-size:19px;font-weight:700\">" + (es ? "SnapCal no pudo abrir" : "SnapCal didn't open") + "</div>" +
      "<div style=\"max-width:300px;color:#5C5C60;font-size:15px\">" + (es
        ? "Tus datos están a salvo en este teléfono. Prueba de nuevo o repara la app."
        : "Your data is safe on this phone. Try again, or repair the app.") + "</div>" +
      "<button type=\"button\" data-act=\"retry\" style=\"" + btn + "background:#000;color:#fff\">" + (es ? "Intentar de nuevo" : "Try again") + "</button>" +
      "<button type=\"button\" data-act=\"repair\" style=\"" + btn + "background:#fff;color:#000;box-shadow:inset 0 0 0 1.5px #000\">" + (es ? "Reparar la app" : "Repair the app") + "</button>" +
      "<div style=\"max-width:320px;font-size:11px;color:#5C5C60;word-break:break-word;white-space:pre-wrap\"></div>";
    var detail = box.lastChild;
    detail.textContent = (errors.length ? errors[0].split("\n")[0] + "\n" : "") + device();
    if (failedScript) {
      probe(failedScript).then(function (why) {
        note(why);
        detail.textContent += "\n" + why;
        reported = false; // send again, now with the reason
        report();
      });
    }
    box.querySelector("[data-act=retry]").onclick = function () { location.reload(); };
    box.querySelector("[data-act=repair]").onclick = function () { this.disabled = true; repair(); };
    (document.body || document.documentElement).appendChild(box);
  }

  function check() {
    if (drawn()) {
      var old = document.getElementById("boot-rescue");
      if (old) old.remove();
      return;
    }
    var waited = Date.now() - began;
    // A caught error and still nothing drawn: say so soon. No error: give a slow network longer.
    if ((errors.length && waited >= 6000) || waited >= 14000) return show();
    setTimeout(check, 1000);
  }
  setTimeout(check, 6000);
})();
