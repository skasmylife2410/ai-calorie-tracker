// app.js — boot + root shell (ContentView.swift), SPEC-UI.md §2.
// Onboarding gate, custom bottom bar + FAB with the 2x2 popup, tab routing, root-owned
// sheets/covers (camera, food database, describe, saved foods, barcode flow), SW registration.

import * as store from "./store.js";
import { t as translate, initI18n, onLanguageChange } from "./i18n.js";
import * as queue from "./queue.js";
import { initSync } from "./sync.js";
import { foodLookup } from "./api.js";
import { icon } from "./ui/icons.js";
import { render as renderToday } from "./ui/today.js";
import { render as renderHistory } from "./ui/history.js";
import { render as renderProfile } from "./ui/profile.js";
import { render as renderOnboarding } from "./ui/onboarding.js";
import { openCameraScan } from "./ui/scan.js";
import { openFoodSearchSheet } from "./ui/search.js";
import { openDescribeMealSheet } from "./ui/describe.js";
import { openFavouritesSheet } from "./ui/favourites.js";
import { openExerciseSheet } from "./ui/exercise.js";
import { viewedTimestamp } from "./ui/today.js";
import { renderLogin, hasValidSession } from "./ui/login.js";
import { render as renderWeight } from "./ui/weight.js";
import { render as renderTodayMeals, viewedTabTimestamp } from "./ui/today-meals.js";
import { renderUsTab } from "./us.js";
import { wireTabSwipe } from "./ui/tab-swipe.js";
import { mountSky } from "./ui/sky.js";
import { openRecipesSheet } from "./ui/recipes.js";
import { openAddFoodSheet } from "./ui/addfood.js";
import { openSheet, navBar, wireNavBar } from "./ui/sheet.js";
import { refreshPush, clearBadge } from "./push.js";
import { maybeShowWhatsNew } from "./ui/push-ui.js";

const TABS = [
  { id: "home", labelKey: "tabs.home", icon: "houseFill" },
  { id: "today", labelKey: "todayTab.tab", icon: "forkKnife" },
  { id: "us", labelKey: "us.tab", icon: "personFill" },
  { id: "weight", labelKey: "weight.tab", icon: "scale" },
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
  { id: "recipes", icon: "wandAndStars", labelKey: "menu.ideas", color: "#E2A03F" },
];

let selectedTab = "home";
let popupOpen = false;
let hasProfile = false;

const appRoot = document.getElementById("app-root");

function profileExists() {
  try {
    return localStorage.getItem("snapcal.userProfile") !== null;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function boot() {
  mountSky(); // time-of-day glow, first so there's colour before anything else paints
  queue.sweepIfNeeded(); // reload mid-analysis -> orphaned pendings become retryable-failed
  // Language comes from the profile (so it travels between this person's devices), else the phone.
  await initI18n({ stored: store.getProfile().language });
  onLanguageChange(() => renderShell());
  // Accounts: no valid session -> the login screen owns the app until they sign in.
  // Anything that throws in here must NOT leave a blank page, so the whole thing is guarded:
  // a broken login is still better than an app that won't start.
  try {
    if (!(await hasValidSession())) {
      await renderLogin(appRoot);
    }
  } catch (err) {
    console.error("app.js: login failed, continuing unauthenticated", err);
  }

  initSync();
  hasProfile = profileExists();

  store.subscribe(() => {
    renderCurrentTab();
  });

  renderShell();

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
  if (hasProfile && !opened) setTimeout(() => maybeShowWhatsNew().catch(() => {}), 800);
}

/** Handles ?tab=us / ?whatsnew=1 from a notification. Returns true when it did something. */
function openFromUrl(href) {
  let url;
  try { url = new URL(href, location.origin); } catch { return false; }
  const tab = url.searchParams.get("tab");
  const whatsNew = url.searchParams.get("whatsnew") === "1";
  if (url.search) history.replaceState(null, "", "/");
  if (!hasProfile) return false;
  if (tab && TABS.some((x) => x.id === tab)) {
    if (popupOpen) setPopupOpen(false);
    selectedTab = tab;
    renderShell();
  }
  if (whatsNew) maybeShowWhatsNew({ force: true }).catch(() => {});
  return Boolean(tab || whatsNew);
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
    });
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

  // Swipe between tabs. Profile isn't in the bar, so it isn't part of the swipe order.
  const content = appRoot.querySelector("#tab-content");
  if (content && !content.dataset.swipeWired) {
    content.dataset.swipeWired = "1";
    const order = TABS.map((t) => t.id);
    wireTabSwipe({
      surface: content,
      count: () => order.length,
      getIndex: () => Math.max(0, order.indexOf(selectedTab)),
      onChange: (i) => {
        selectedTab = order[i];
        appRoot.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === selectedTab));
        renderCurrentTab();
        content.scrollTop = 0;
      },
    });
  }

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
  return selectedTab === "today" ? viewedTabTimestamp() : viewedTimestamp();
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

function renderCurrentTab() {
  const content = document.getElementById("tab-content");
  if (!content) return;
  if (selectedTab === "home") renderToday(content);
  else if (selectedTab === "today") renderTodayMeals(content);
  else if (selectedTab === "us") renderUsTab(content);
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
        ${navBar({ title: "", leading: { label: t("app.cancel") } })}
        <div class="sheet-panel-body">
          <div class="barcode-progress-body">
            <div class="spinner"></div>
            <div class="barcode-progress-text">Looking up ${escapeHtml(barcode)}…</div>
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

  foodLookup(barcode).then((outcome) => {
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
