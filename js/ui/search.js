// search.js — Food Database search (FoodSearchView.swift), SPEC-UI.md §8.
// Backed by Open Food Facts name search (debounced 400ms), selecting a result opens
// AddFoodView prefilled with the product (§19 ScannedProduct).

import { offSearchByName, usdaSearchByName } from "../api.js";
import { icon } from "./icons.js";
import { openSheet, navBar, wireNavBar } from "./sheet.js";
import { openAddFoodSheet } from "./addfood.js";
import { searchLocalFoods } from "../foods-local.js";
import { currentLanguage } from "../i18n.js";

const DEBOUNCE_MS = 400;

export function openFoodSearchSheet() {
  let state = { kind: "idle" }; // idle | loading | results | noResults | error
  let query = "";
  let debounceTimer = null;
  let searchGeneration = 0;

  openSheet({
    render(panel, close) {
      panel.innerHTML = `
        ${navBar({
          title: "Food Database",
          leading: { label: "Close" },
          trailing: { label: "Add manually" },
        })}
        <div class="search-field-wrap">
          <div class="search-field">
            ${icon("magnifyingglass", { size: 18 })}
            <input type="text" class="search-input" id="search-input" placeholder="Search foods…"
              autocomplete="off" autocorrect="off" spellcheck="false" />
            <button class="search-clear-btn hidden" id="search-clear">${icon("xmarkCircleFill", { size: 18 })}</button>
          </div>
        </div>
        <div class="sheet-panel-body" id="search-content"></div>
      `;

      const input = panel.querySelector("#search-input");
      const clearBtn = panel.querySelector("#search-clear");
      const content = panel.querySelector("#search-content");

      const renderState = () => {
        clearBtn.classList.toggle("hidden", query === "");
        if (state.kind === "idle") {
          content.innerHTML = emptyStateHtml({
            iconName: "magnifyingglass",
            title: "Search the food database",
            message: "Find packaged foods by name or brand.",
          });
        } else if (state.kind === "loading") {
          content.innerHTML = `<div class="loading-center"><div class="spinner"></div></div>`;
        } else if (state.kind === "results") {
          content.innerHTML = `<div class="search-results">${state.products.map(resultRowHtml).join("")}</div>`;
          content.querySelectorAll("[data-result-idx]").forEach((row) => {
            row.addEventListener("click", () => {
              const product = state.products[Number(row.dataset.resultIdx)];
              close();
              openAddFoodSheet({ prefill: product });
            });
          });
        } else if (state.kind === "noResults") {
          content.innerHTML = emptyStateHtml({
            iconName: "questionmarkCircle",
            title: "No results",
            message: `No foods found for “${escapeHtml(state.query)}”. Try a different search, or add it manually.`,
            retry: true,
          });
          wireRetry(content);
        } else if (state.kind === "error") {
          content.innerHTML = emptyStateHtml({
            iconName: "wifiSlash",
            title: "Search unavailable",
            message: escapeHtml(state.message),
            retry: true,
          });
          wireRetry(content);
        }
      };

      const runSearch = async () => {
        const trimmed = query.trim();
        if (trimmed === "") {
          state = { kind: "idle" };
          renderState();
          return;
        }
        const generation = ++searchGeneration;
        // Built-in foods match partial words ("pech", "arep") and need no network, so they
        // show immediately while the databases are still being asked. Both remote sources
        // only match whole words, which is why typing half a word used to return nothing.
        const local = searchLocalFoods(trimmed, { lang: currentLanguage() === "es" ? "es" : "en" });
        state = local.length > 0 ? { kind: "results", products: local, loadingMore: true } : { kind: "loading" };
        renderState();
        // USDA covers plain whole foods with clean names ("Bananas, raw"); OFF covers branded
        // packaged products. Both run in parallel; USDA's cleaner matches lead the list, since a
        // person typing "banana" almost always means the fruit, not a branded banana product.
        const [usda, off] = await Promise.all([usdaSearchByName(trimmed), offSearchByName(trimmed)]);
        if (generation !== searchGeneration) return; // superseded by a newer search

        const usdaProducts = usda.status === "success" ? usda.products : [];
        const offProducts = off.status === "success" ? off.products : [];
        // built-in first (they matched what was actually typed), then the databases, no repeats
        const seen = new Set(local.map((p) => p.name.toLowerCase()));
        const remote = [...usdaProducts, ...offProducts].filter((p) => {
          const key = String(p.name ?? "").toLowerCase();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        const products = [...local, ...remote];

        if (products.length > 0) {
          state = { kind: "results", products };
        } else if (usda.status === "failed" && off.status === "failed") {
          state = { kind: "error", message: off.message };
        } else {
          state = { kind: "noResults", query: trimmed };
        }
        renderState();
      };

      const wireRetry = (contentEl) => {
        const btn = contentEl.querySelector("[data-retry]");
        if (btn) btn.addEventListener("click", runSearch);
      };

      input.addEventListener("input", () => {
        query = input.value;
        clearBtn.classList.toggle("hidden", query === "");
        clearTimeout(debounceTimer);
        if (query.trim() === "") {
          searchGeneration += 1; // cancel any in-flight result application
          state = { kind: "idle" };
          renderState();
          return;
        }
        debounceTimer = setTimeout(runSearch, DEBOUNCE_MS);
      });

      clearBtn.addEventListener("click", () => {
        query = "";
        input.value = "";
        clearTimeout(debounceTimer);
        searchGeneration += 1;
        state = { kind: "idle" };
        renderState();
        input.focus();
      });

      wireNavBar(panel, {
        onLeading: () => close(),
        onTrailing: () => openAddFoodSheet({}),
      });

      renderState();
      setTimeout(() => input.focus(), 350);
    },
  });
}

function resultRowHtml(product, idx) {
  return `
    <div class="search-result-row card" data-result-idx="${idx}">
      <div class="search-result-left">
        <div class="search-result-name">${escapeHtml(product.name)}</div>
        ${product.brand ? `<div class="search-result-brand">${escapeHtml(product.brand)}</div>` : ""}
      </div>
      <div class="search-result-right">
        <div class="search-result-cal">${Math.round(product.calories)} kcal</div>
        <div class="search-result-serving">${escapeHtml(product.servingDescription)}</div>
      </div>
    </div>
  `;
}

function emptyStateHtml({ iconName, title, message, retry = false }) {
  return `
    <div class="empty-state">
      ${icon(iconName, { size: 40 })}
      <div class="empty-state-title">${title}</div>
      <div class="empty-state-message">${message}</div>
      ${retry ? `<button class="btn-bordered" style="width:auto;padding:8px 20px;" data-retry>Try again</button>` : ""}
    </div>
  `;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}
