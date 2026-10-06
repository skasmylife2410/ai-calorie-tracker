// app.js — boot + root shell (ContentView.swift), SPEC-UI.md §2.
// Onboarding gate, custom bottom bar + FAB with the 2x2 popup, tab routing, root-owned
// sheets/covers (camera, food database, describe, saved foods, barcode flow), SW registration.

import * as store from "./store.js";
import { sfx, setSoundsEnabled, unlockSoundsOnTouch } from "./sounds.js";
import { applyMood, moodFor, lastMealAt } from "./mood.js";
import { t as translate, initI18n, onLanguageChange } from "./i18n.js";
import * as queue from "./queue.js";
import { initSync, whenFirstSynced } from "./sync.js";
import { getStoredToken } from "./net.js";
import { foodLookup } from "./api.js";
import { icon } from "./ui/icons.js";
import { render as renderToday } from "./ui/today.js";
import { render as renderOnboarding } from "./ui/onboarding.js";
import { startAutoUpdate, applyIfPending } from "./updater.js";
import "./install.js"; // catches Android Chrome's install offer as early as possible
import { viewedTimestamp } from "./ui/today.js";
import { renderLogin, hasValidSession, consentNeeded, renderConsent } from "./ui/login.js";

import { mountSky } from "./ui/sky.js";
import { applyTheme, watchSystemTheme } from "./theme.js";
import { openSheet, navBar, wireNavBar } from "./ui/sheet.js";
import { refreshPush, clearBadge } from "./push.js";
import { maybeShowWhatsNew } from "./ui/push-ui.js";
import { maybeShowGoalsUpdate } from "./ui/goals-update.js";

// Screens and sheets that aren't on Home load the first time they're opened, and in the
// background once Home is up, so opening the app parses far less code. (The service worker
// has them all cached, so loading one is quick even offline.)
const laterLoads = [];
function later(load, name) {
  laterLoads.push(load);
  return (...args) => load().then((m) => m[name](...args)).catch((err) => console.error(`app.js: ${name} failed to load`, err));
}
/** A tab's render, loaded later; draws only if that tab is still the one showing. */
function laterTab(load, name) {
  laterLoads.push(load);
  return (content) => {
    const tab = selectedTab;
    return load()
      .then((m) => { if (selectedTab === tab && content.isConnected) m[name](content); })
      .catch((err) => console.error(`app.js: ${name} failed to load`, err));
  };
}
let preloaded = false;
function preloadLater() {
  if (preloaded) return;
  preloaded = true;
  const run = () => laterLoads.forEach((load) => load().catch(() => {}));
  if (typeof globalThis.requestIdleCallback === "function") globalThis.requestIdleCallback(run, { timeout: 4000 });
  else setTimeout(run, 2500);
}
const renderHistory = laterTab(() => import("./ui/history.js"), "render");
const renderProfile = laterTab(() => import("./ui/profile.js"), "render");
const renderSharedTab = laterTab(() => import("./ui/shared-tab.js"), "render");
const openCameraScan = later(() => import("./ui/scan.js"), "openCameraScan");
const openFoodSearchSheet = later(() => import("./ui/search.js"), "openFoodSearchSheet");
const openDescribeMealSheet = later(() => import("./ui/describe.js"), "openDescribeMealSheet");
const openFavouritesSheet = later(() => import("./ui/favourites.js"), "openFavouritesSheet");
const openExerciseSheet = later(() => import("./ui/exercise.js"), "openExerciseSheet");
const renderWeight = laterTab(() => import("./ui/weight.js"), "render");
const renderUsTab = laterTab(() => import("./us.js"), "renderUsTab");
const openRecipesSheet = later(() => import("./ui/recipes.js"), "openRecipesSheet");
const openAddFoodSheet = later(() => import("./ui/addfood.js"), "openAddFoodSheet");

const TABS = [
  { id: "home", labelKey: "tabs.home", icon: "houseFill" },
  { id: "us", labelKey: "us.tab", icon: "personFill" },
  { id: "shared", labelKey: "social.tab", icon: "textBubbleFill" },
  { id: "weight", labelKey: "weight.tab", icon: "chartBarFill" }, // the Progress tab (id kept for old links)
];
// Profile has no tab of its own any more; it opens from the avatar at the top of Home.

// Popup tile grid — exact 2x2 order (§2.2): row 1 = look something up, row 2 = capture new.
// Left-to-right around the arc above the + button. The camera sits top centre, the most-used way in.
const POPUP_TILES = [
  { id: "saved", icon: "bookmarkFill", labelKey: "menu.favourites", color: "#D8487A" },
  { id: "search", icon: "magnifyingglass", labelKey: "menu.database", color: "#2F6BE8" },
  { id: "describe", icon: "textBubbleFill", labelKey: "menu.describe", color: "#7B5AD9" },
  { id: "scan", icon: "cameraViewfinder", labelKey: "menu.scan", color: "#F0562D", primary: true },
  { id: "voice", icon: "mic", labelKey: "voice.tile", color: "#3BA7DB" },
  { id: "exercise", icon: "boltFill", labelKey: "menu.exercise", color: "#2AA66B" },
  // "What should I eat?" lives on Home only (it answers "what fits in what's left today")
];

let selectedTab = (() => {
  // an automatic update reloads the page; come back to the tab that was open
  try {
    const kept = sessionStorage.getItem("snapcal.tabBeforeUpdate");
    sessionStorage.removeItem("snapcal.tabBeforeUpdate");
    return kept || "home";
  } catch { return "home"; }
})();
let popupOpen = false;
let hasProfile = false;

const appRoot = document.getElementById("app-root");

/** A full profile (weight and height set), as the server holds for anyone who finished setup. */
function accountProfileArrived() {
  try {
    const p = JSON.parse(localStorage.getItem("snapcal.userProfile") || "null");
    return Boolean(p && Number(p.weightKg) > 0 && Number(p.heightCm) > 0);
  } catch {
    return false;
  }
}

/**
 * Setup is done: it said so at its last step, or (for people who set up before that marker
 * existed) weight, height and age are all filled in. Someone who left setup halfway, often
 * right after picking a language, which already saves a profile, is shown it again next time.
 */
export function profileComplete(p) {
  if (!p || typeof p !== "object") return false;
  if (p.hasCompletedOnboarding === true) return true;
  return Number(p.weightKg) > 0 && Number(p.heightCm) > 0 && Number(p.age) > 0;
}

function profileExists() {
  try {
    return profileComplete(JSON.parse(localStorage.getItem("snapcal.userProfile") || "null"));
  } catch {
    return false;
  }
}

/** Some answers saved already (a setup left halfway): setup starts from them. */
function profileStarted() {
  try { return localStorage.getItem("snapcal.userProfile") !== null; } catch { return false; }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function boot() {
  // None of these extras may stop the app from opening: each one failing is logged and skipped
  // (a blank page was the result when one threw on a phone).
  const soft = (label, fn) => {
    try { return fn(); } catch (err) { console.error(`app.js: ${label} failed`, err); return undefined; }
  };
  soft("sky", () => mountSky()); // time-of-day glow, first so there's colour before anything else paints
  soft("theme", () => applyTheme(store.getProfile())); // Mono or Classic (js/theme-boot.js already did this before paint)
  soft("sounds", () => { setSoundsEnabled(store.getProfile().soundsOn); unlockSoundsOnTouch(); });
  soft("system theme", () => watchSystemTheme(store.getProfile));
  // Meals cut off mid-analysis are retried, but only after this phone has the account's latest
  // copies: a meal another phone already finished must not be re-analysed (or zeroed) here.
  soft("heal", () => store.healZeroEntries());
  whenFirstSynced(8000).then(() => soft("sweep", () => queue.sweepIfNeeded()));
  // An analysis under 50% sure comes back with questions: ask them right away if the app is on
  // screen and nothing else is open; otherwise the meal's row offers them.
  soft("ask", () => queue.onComplete(({ entryId, success }) => {
    if (success && document.visibilityState === "visible") sfx("log");
    if (!success || document.visibilityState !== "visible" || document.querySelector(".sheet-panel")) return;
    const entry = store.getFoodEntry(entryId);
    if (entry?.analysisQuestions?.length) import("./ui/questions.js").then((m) => m.openQuestionsSheet(entry)).catch(() => {});
  }));
  // Language comes from the profile (so it travels between this person's devices), else the phone.
  try {
    await initI18n({ stored: store.getProfile().language });
  } catch (err) {
    console.error("app.js: languages failed to load", err);
  }
  onLanguageChange(() => renderShell());
  // Accounts: no valid session -> the login screen owns the app until they sign in.
  // Anything that throws in here must NOT leave a blank page, so the whole thing is guarded:
  // a broken login is still better than an app that won't start.
  try {
    if (!(await hasValidSession())) {
      await renderLogin(appRoot);
    }
    // Health data needs the person's agreement to the current privacy policy before the app
    // collects anything; accounts made before the policy existed are asked once here.
    if (await consentNeeded()) await renderConsent(appRoot);
  } catch (err) {
    console.error("app.js: login failed, continuing unauthenticated", err);
  }

  initSync();
  hasProfile = profileExists();
  // Signed in but nothing on this phone (a reinstall, another browser, cleared data): the
  // account may well exist already. Wait for its data before offering first-time setup;
  // otherwise setup's answers are newer than the real profile and overwrite it everywhere.
  if (!hasProfile && getStoredToken()) {
    appRoot.innerHTML = `<div class="boot-wait" role="status">${translate("app.loadingAccount")}</div>`;
    await whenFirstSynced(8000);
    hasProfile = profileExists();
  }

  // Exercise burns are estimated more conservatively now; recalculate the old estimates once,
  // after this phone has the account's exercise from the server.
  whenFirstSynced(8000).then(() => {
    try { store.refreshExerciseEstimates(); } catch { /* never block the app */ }
    try { store.syncLearnedTdeeFlag(); } catch { /* never block the app */ }
  });

  store.subscribe(() => {
    // The account's profile arrived after setup was already showing (slow network): step out
    // of setup into the app instead of letting it overwrite the real profile.
    if (!hasProfile && accountProfileArrived()) {
      hasProfile = true;
      renderShell();
      return;
    }
    applyTheme(store.getProfile()); // a theme picked here or synced from another phone
    setSoundsEnabled(store.getProfile().soundsOn);
    renderCurrentTab();
  });

  if (!TABS.some((x) => x.id === selectedTab)) selectedTab = "home";
  renderShell();

  // New versions arrive on their own: see js/updater.js for when it's safe to reload.
  startAutoUpdate({
    onBeforeReload: () => sessionStorage.setItem("snapcal.tabBeforeUpdate", selectedTab),
    onUpdated: () => {
      const el = document.createElement("div");
      el.className = "undo-toast";
      el.innerHTML = `<span class="undo-text">✓ ${translate("app.updated")}</span>`;
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 2600);
    },
  });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.warn("app.js: service worker registration failed", err);
    });
    // a notification tapped while the app is already open
    navigator.serviceWorker.addEventListener("message", (e) => {
      if (e.data?.type === "snapcal:open") openFromUrl(e.data.url);
    });
  }

  // Notifications: clear the icon badge, keep this phone's subscription current, then either
  // follow the link a notification opened us with or show the latest update once.
  clearBadge();
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") clearBadge(); });
  refreshPush().catch(() => {});
  const opened = openFromUrl(location.href);
  // the message about updated targets comes first; the general "what's new" waits its turn
  const showUpdates = () => { if (!maybeShowGoalsUpdate()) maybeShowWhatsNew().catch(() => {}); };
  if (hasProfile && !opened) setTimeout(showUpdates, 800);
  // on a phone that only gets its profile from the server, the change is noted after the first sync
  whenFirstSynced(8000).then(() => setTimeout(() => {
    try { store.syncLearnedTdeeFlag(); } catch { /* never block the app */ }
    if (hasProfile && !document.querySelector(".sheet-panel")) maybeShowGoalsUpdate();
    // the 30-day check-in runs after the sync, so a second phone sees it was already done
    if (hasProfile && !document.querySelector(".sheet-panel")) {
      import("./ui/monthly-review.js")
        .then((m) => m.maybeRunMonthlyReview({ onChange: () => { try { refreshMood(); } catch { /* never block */ } } }))
        .catch(() => {});
    }
  }, 1500));
}

/** Handles ?tab=us / ?whatsnew=1 from a notification. Returns true when it did something. */
function openFromUrl(href) {
  let url;
  try { url = new URL(href, location.origin); } catch { return false; }
  const tab = url.searchParams.get("tab");
  const whatsNew = url.searchParams.get("whatsnew") === "1";
  const goals = url.searchParams.get("goals") === "1";
  if (url.search) history.replaceState(null, "", "/");
  if (!hasProfile) return false;
  // the old Today tab now lives on Home as the "Today's meals" mini tab
  if (tab === "today") {
    try { localStorage.setItem("snapcal.homeMealsOpen", "1"); } catch { /* private mode */ }
    if (popupOpen) setPopupOpen(false);
    selectedTab = "home";
    renderShell();
    return true;
  }
  if (tab && TABS.some((x) => x.id === tab)) {
    if (popupOpen) setPopupOpen(false);
    selectedTab = tab;
    renderShell();
  }
  if (whatsNew) maybeShowWhatsNew({ force: true }).catch(() => {});
  if (goals) { try { store.syncLearnedTdeeFlag(); } catch { /* never block the app */ } maybeShowGoalsUpdate({ force: true }); }
  return Boolean(tab || whatsNew || goals);
}

// ---------------------------------------------------------------------------
// Shell rendering
// ---------------------------------------------------------------------------

function renderShell() {
  if (!hasProfile) {
    appRoot.innerHTML = `<div class="screen scroll-view" id="onboarding-screen"></div>`;
    renderOnboarding(document.getElementById("onboarding-screen"), () => {
      hasProfile = true;
      renderShell();
    }, { resume: profileStarted() });
    return;
  }

  appRoot.innerHTML = `
    <div class="scroll-view" id="tab-content"></div>
    <div class="fab-scrim hidden" id="fab-scrim"></div>
    <div class="fab-arc hidden" id="fab-popup">
      <div class="fab-arc-caption" id="fab-caption"></div>
      ${POPUP_TILES.map((t, i) => {
        // spread across the top of a wide arc, 205° to 335° (270° is straight up): wide enough
        // that seven buttons sit ~10px apart, high enough that the ends clear the + button
        const angle = 205 + (130 / (POPUP_TILES.length - 1)) * i;
        return `
        <button class="fab-dot${t.primary ? " is-primary" : ""}" data-tile="${t.id}" data-label="${translate(t.labelKey)}"
                aria-label="${translate(t.labelKey)}" style="--a:${angle}deg;--c:${t.color};--i:${i}">
          ${icon(t.icon, { size: t.primary ? 26 : 22 })}
        </button>`;
      }).join("")}
    </div>
    <div class="bottom-bar-wrap">
      <div class="bottom-bar">
        <div class="bottom-bar-backdrop"></div>
        <div class="bottom-bar-bump"></div>
        <div class="bottom-bar-row">
          <div class="bottom-bar-half">${TABS.slice(0, 2).map(tabButtonHtml).join("")}</div>
          <div class="fab-slot"></div>
          <div class="bottom-bar-half right">${TABS.slice(2).map(tabButtonHtml).join("")}</div>
        </div>
        <button class="fab-btn" id="fab-btn">${icon("plus", { size: 24 })}</button>
      </div>
    </div>
  `;

  wireShell();
  renderCurrentTab();
  preloadLater();
}

function tabButtonHtml(tab) {
  const active = tab.id === selectedTab;
  return `
    <button class="tab-btn${active ? " active" : ""}" data-tab="${tab.id}">
      <span class="tab-icon-pill">${icon(tab.icon, { size: 19 })}</span>
      <span class="tab-label">${translate(tab.labelKey)}</span>
    </button>
  `;
}

function wireShell() {
  appRoot.querySelectorAll("[data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (popupOpen) setPopupOpen(false);
      if (btn.dataset.tab === selectedTab) return;
      selectedTab = btn.dataset.tab;
      applyIfPending(); // switching tabs is a natural moment to pick up a waiting update
      appRoot.querySelectorAll("[data-tab]").forEach((b) => b.classList.toggle("active", b.dataset.tab === selectedTab));
      renderCurrentTab();
    });
  });

  const fabBtn = appRoot.querySelector("#fab-btn");
  fabBtn.addEventListener("click", () => setPopupOpen(!popupOpen));

  appRoot.querySelector("#fab-scrim").addEventListener("click", () => setPopupOpen(false));
  const caption = appRoot.querySelector("#fab-caption");
  appRoot.querySelectorAll(".fab-dot").forEach((dot) => {
    const show = () => { if (caption) { caption.textContent = dot.dataset.label; caption.style.color = getComputedStyle(dot).getPropertyValue("--c"); } };
    dot.addEventListener("pointerenter", show);
    dot.addEventListener("pointerdown", show);
    dot.addEventListener("focus", show);
  });

  appRoot.querySelectorAll("[data-tile]").forEach((tile) => {
    tile.addEventListener("click", () => {
      setPopupOpen(false);
      handleTileAction(tile.dataset.tile);
    });
  });
}

function setPopupOpen(open) {
  popupOpen = open;
  const scrim = appRoot.querySelector("#fab-scrim");
  const popup = appRoot.querySelector("#fab-popup");
  const fabBtn = appRoot.querySelector("#fab-btn");
  if (!scrim || !popup || !fabBtn) return;

  fabBtn.classList.toggle("open", open);
  if (open) {
    // centre the arc on the + button's real position, whatever the phone's size or insets
    const r = fabBtn.getBoundingClientRect();
    popup.style.left = `${r.left + r.width / 2}px`;
    popup.style.top = `${r.top + r.height / 2}px`;
    popup.style.bottom = "auto";
    scrim.classList.remove("hidden");
    popup.classList.remove("hidden");
    requestAnimationFrame(() => {
      scrim.classList.add("visible");
      popup.classList.add("visible");
    });
  } else {
    scrim.classList.remove("visible");
    popup.classList.remove("visible");
    setTimeout(() => {
      if (!popupOpen) {
        scrim.classList.add("hidden");
        popup.classList.add("hidden");
      }
    }, 350);
  }
}

/** Which day new food belongs to: the day the visible tab is showing. */
function activeTimestamp() {
  return viewedTimestamp();
}

function handleTileAction(tileId) {
  switch (tileId) {
    case "saved":
      openFavouritesSheet({ timestamp: activeTimestamp() });
      break;
    case "search":
      openFoodSearchSheet();
      break;
    case "scan":
      openCameraScan({ onResult: handleCameraResult });
      break;
    case "describe":
      openDescribeMealSheet({ timestamp: activeTimestamp() });
      break;
    case "voice":
      openDescribeMealSheet({ voice: true, timestamp: activeTimestamp() });
      break;
    case "exercise":
      openExerciseSheet({ onSaved: () => renderCurrentTab() });
      break;
    case "recipes":
      openRecipesSheet();
      break;
  }
}

/** Lets a screen move to another tab, e.g. Home's avatar opening Profile. */
globalThis.snapcalGoTo = (tab) => {
  selectedTab = tab;
  renderShell();
};

/** Over budget today → meltdown; two days without a meal → gloom (see js/mood.js). */
function refreshMood() {
  try { if (hasProfile) { store.syncLearnedTdeeFlag(); store.syncDaySummaries(); } } catch { /* never block the app */ }
  try {
    applyMood(moodFor({ remainingToday: store.dayEnergy(new Date()).remaining, lastMeal: lastMealAt(store.allFoodEntries()) }));
  } catch (err) {
    console.error("app.js: mood failed", err);
  }
}

function renderCurrentTab() {
  const content = document.getElementById("tab-content");
  if (!content) return;
  refreshMood();
  if (selectedTab === "home") renderToday(content);
  else if (selectedTab === "us") renderUsTab(content);
  else if (selectedTab === "shared") renderSharedTab(content);
  else if (selectedTab === "weight") renderWeight(content);
  else if (selectedTab === "progress") renderHistory(content);
  else renderProfile(content);
}

// ---------------------------------------------------------------------------
// Camera result routing (§2.4): photos -> analysis queue; barcode -> lookup flow
// ---------------------------------------------------------------------------

function handleCameraResult(result) {
  if (result.type === "foodPhoto") {
    // anything typed on the camera screen goes to the model with the picture
    queue.enqueuePhoto(result.dataUrl, "meal", { description: result.note ?? null });
    selectedTab = "home";
    renderShell();
  } else if (result.type === "labelPhoto") {
    queue.enqueuePhoto(result.dataUrl, "label", { description: result.note ?? null });
    selectedTab = "home";
    renderShell();
  } else if (result.type === "barcode") {
    startBarcodeFlow(result.code);
  }
}

/** BarcodeLookupProgressView (§5.5) -> AddFood prefill variants (§7.2). */
function startBarcodeFlow(barcode) {
  let cancelled = false;
  let progressClose = null;

  openSheet({
    render(panel, close) {
      progressClose = close;
      panel.innerHTML = `
        ${navBar({ title: "", leading: { label: translate("app.cancel") } })}
        <div class="sheet-panel-body">
          <div class="barcode-progress-body">
            <div class="spinner"></div>
            <div class="barcode-progress-text">${escapeHtml(translate("scan.lookingUp", { code: barcode }))}</div>
          </div>
        </div>
      `;
      wireNavBar(panel, {
        onLeading: () => {
          cancelled = true;
          close();
        },
      });
    },
    onClosed: () => {
      cancelled = true;
    },
  });

  // Never more than 20 s on "Looking up…": past that, open Add Food with the barcode so the
  // numbers can be typed from the package.
  const slow = new Promise((resolve) => setTimeout(() => resolve({ status: "failed", message: translate("scan.slow") }), 20000));
  Promise.race([foodLookup(barcode).catch((err) => ({ status: "failed", message: String(err?.message ?? err) })), slow]).then((outcome) => {
    if (cancelled) return;
    cancelled = true; // consume the flow exactly once
    if (progressClose) progressClose();
    setTimeout(() => {
      if (outcome.status === "found") {
        openAddFoodSheet({ prefill: outcome.product, timestamp: activeTimestamp() });
      } else if (outcome.status === "notFound") {
        openAddFoodSheet({ prefillBarcode: barcode, timestamp: activeTimestamp() });
      } else {
        openAddFoodSheet({ prefillBarcode: barcode, failureReason: outcome.message, timestamp: activeTimestamp() });
      }
    }, 340);
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

boot();
