// gif-picker.js — the GIF sheet used by Shared (posts and comments) and by notes.
// Opens on trending, with a search box and a row of quick words; tapping a GIF resolves with it.
// GIPHY's terms ask for their credit wherever their results are shown, hence the footer line.

import { t, currentLanguage } from "../i18n.js";
import { openSheet, navBar, wireNavBar } from "./sheet.js";
import { searchGifs } from "../social.js";
import { GIF_TOPICS, gifImgHtml, cleanGif } from "../gif.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** @returns {Promise<{id:string, w:number, h:number}|null>} null when closed without picking */
export function openGifPicker() {
  return new Promise((resolve) => {
    let picked = null;
    openSheet({
      render(panel, close) {
        panel.classList.add("gif-sheet");
        panel.innerHTML = `
          ${navBar({ title: "GIF", leading: { label: t("app.cancel") } })}
          <div class="sheet-panel-body gif-body">
            <label class="gif-search">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M20 20l-4.8-4.8"/></svg>
              <input type="search" id="gif-q" enterkeyhint="search" autocomplete="off" placeholder="${t("gif.search")}" aria-label="${t("gif.search")}">
            </label>
            <div class="gif-topics" role="group" aria-label="${t("gif.topics")}">
              ${GIF_TOPICS.map((g, i) => `<button type="button" data-topic="${i}" aria-pressed="${i === 0}">${t(`gif.topic.${g.key}`)}</button>`).join("")}
            </div>
            <div class="gif-grid" id="gif-grid" aria-live="polite"></div>
            <p class="gif-credit">${t("gif.credit")}</p>
          </div>`;
        wireNavBar(panel, { onLeading: () => close() });

        const grid = panel.querySelector("#gif-grid");
        const input = panel.querySelector("#gif-q");
        const topics = [...panel.querySelectorAll("[data-topic]")];
        let asked = 0; // only the newest answer is drawn
        const load = async (q) => {
          const mine = ++asked;
          grid.innerHTML = `<p class="gif-note">…</p>`;
          const out = await searchGifs(q, currentLanguage());
          if (mine !== asked) return;
          if (!out.ok) {
            grid.innerHTML = `<p class="gif-note">${esc(out.errorType === "unconfigured" ? t("gif.unconfigured") : out.message || t("errors.generic"))}</p>`;
            return;
          }
          const gifs = (out.gifs ?? []).map(cleanGif).filter(Boolean);
          if (!gifs.length) { grid.innerHTML = `<p class="gif-note">${t("gif.none")}</p>`; return; }
          // two columns, each GIF into the shorter one, so the grid stays even
          const cols = [[], []], height = [0, 0];
          gifs.forEach((g, i) => { const c = height[0] <= height[1] ? 0 : 1; cols[c].push(i); height[c] += g.h / g.w; });
          grid.innerHTML = cols.map((col) => `<div class="gif-col">${col.map((i) =>
            `<button type="button" class="gif-pick" data-i="${i}" aria-label="GIF ${i + 1}">${gifImgHtml(gifs[i], { cls: "gif-img" })}</button>`).join("")}</div>`).join("");
          grid.querySelectorAll("[data-i]").forEach((b) => b.addEventListener("click", () => {
            picked = gifs[Number(b.dataset.i)];
            close();
          }));
        };
        const setTopic = (i) => topics.forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.topic) === i)));
        topics.forEach((b) => b.addEventListener("click", () => {
          const i = Number(b.dataset.topic);
          setTopic(i);
          input.value = "";
          load(GIF_TOPICS[i].q);
        }));
        let timer = null;
        input.addEventListener("input", () => {
          clearTimeout(timer);
          timer = setTimeout(() => {
            const q = input.value.trim();
            setTopic(q ? -1 : 0);
            load(q);
          }, 350);
        });
        input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); input.blur(); } });
        load("");
      },
      onClosed() { resolve(picked); },
    });
  });
}
