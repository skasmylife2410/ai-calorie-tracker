// delete-account.js — the account deletion page (delete-account.html), which Google Play links to
// as SnapCal's "delete your account" web address: anyone can delete their account and all its
// data here without the app. It signs in with the username and password (api/auth.js "login"),
// then asks the same "deleteAccount" the app's Profile uses, which needs the password again.
// No inline scripts: the site's CSP forbids them.

const TEXT = {
  en: {
    title: "Delete your account · SnapCal",
    formTitle: "Delete it now",
    username: "Username",
    password: "Password",
    sure: "I understand this deletes my account and all its data, permanently.",
    go: "Delete my account",
    working: "Deleting…",
    done: "Your account and all its data have been deleted. You can close this page.",
    badLogin: "Wrong username or password.",
    tooMany: "Too many attempts. Try again in 15 minutes.",
    failed: "That didn't work. Try again, or email us.",
    offline: "No connection. Try again when you're online.",
    help: 'Can\'t sign in? Email <a href="mailto:skasmylife2410@gmail.com">skasmylife2410@gmail.com</a> from any address, with your username, and we\'ll delete the account within 30 days. Read the <a href="/privacy.html">privacy policy</a>.',
  },
  es: {
    title: "Eliminar tu cuenta · SnapCal",
    formTitle: "Eliminarla ahora",
    username: "Nombre de usuario",
    password: "Contraseña",
    sure: "Entiendo que esto borra mi cuenta y todos sus datos, de forma definitiva.",
    go: "Eliminar mi cuenta",
    working: "Eliminando…",
    done: "Tu cuenta y todos sus datos se han eliminado. Puedes cerrar esta página.",
    badLogin: "Usuario o contraseña incorrectos.",
    tooMany: "Demasiados intentos. Prueba otra vez en 15 minutos.",
    failed: "No funcionó. Inténtalo de nuevo o escríbenos.",
    offline: "Sin conexión. Inténtalo cuando tengas internet.",
    help: '¿No puedes entrar? Escribe a <a href="mailto:skasmylife2410@gmail.com">skasmylife2410@gmail.com</a> desde cualquier correo, con tu nombre de usuario, y borraremos la cuenta en un plazo de 30 días. Lee la <a href="/privacy.html">política de privacidad</a>.',
  },
};

let lang = "en";
const $ = (id) => document.getElementById(id);
const form = $("da-form");
const user = $("da-user");
const pass = $("da-pass");
const sure = $("da-sure");
const go = $("da-go");
const msg = $("da-msg");
let busy = false;
let deleted = false;
let shown = ""; // the key of the message on screen, so a language switch rewrites it too

function say(key) {
  shown = key;
  msg.textContent = key ? TEXT[lang][key] : "";
}

function show(next) {
  lang = next === "es" ? "es" : "en";
  const tx = TEXT[lang];
  document.querySelectorAll("[data-lang-block]").forEach((b) => { b.hidden = b.dataset.langBlock !== lang; });
  document.querySelectorAll("[data-lang]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.lang === lang)));
  document.querySelectorAll("[data-t]").forEach((el) => { el.textContent = tx[el.dataset.t]; });
  document.querySelectorAll("[data-t-html]").forEach((el) => { el.innerHTML = tx[el.dataset.tHtml]; });
  document.documentElement.lang = lang;
  document.title = tx.title;
  say(shown);
  refresh();
}

function refresh() {
  go.disabled = busy || deleted || !sure.checked || user.value.trim() === "" || pass.value === "";
  if (busy) go.textContent = TEXT[lang].working;
  else go.textContent = TEXT[lang].go;
}

async function post(body, token = "") {
  const res = await fetch("/api/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { "x-snapcal-token": token } : {}) },
    body: JSON.stringify(body),
  });
  return res.json().catch(() => ({ ok: false }));
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (go.disabled) return;
  busy = true;
  say("");
  refresh();
  try {
    const username = user.value.trim().toLowerCase();
    const login = await post({ op: "login", username, password: pass.value });
    if (!login.ok || !login.token) {
      say(login.errorType === "tooManyAttempts" ? "tooMany" : login.errorType === "badLogin" ? "badLogin" : "failed");
      return;
    }
    const out = await post({ op: "deleteAccount", password: pass.value }, login.token);
    if (!out.ok) {
      say(out.errorType === "tooManyAttempts" ? "tooMany" : out.errorType === "unauthorized" ? "badLogin" : "failed");
      return;
    }
    deleted = true;
    form.reset();
    say("done");
    msg.classList.add("is-done");
    // a phone that was signed in on this browser forgets the account too
    try { localStorage.removeItem("snapcal.apiToken"); } catch { /* private mode */ }
  } catch {
    say("offline");
  } finally {
    busy = false;
    refresh();
  }
});

[user, pass, sure].forEach((el) => el.addEventListener("input", refresh));
sure.addEventListener("change", refresh);
document.querySelectorAll("[data-lang]").forEach((b) => b.addEventListener("click", () => show(b.dataset.lang)));

let saved = "";
try { saved = localStorage.getItem("snapcal.lang") || ""; } catch { /* private mode */ }
const asked = new URLSearchParams(location.search).get("lang") || saved || navigator.language || "en";
show(asked.toLowerCase().startsWith("es") ? "es" : "en");
