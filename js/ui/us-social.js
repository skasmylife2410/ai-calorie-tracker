// us-social.js — the parts of the Us tab that are about each other rather than numbers:
// writing someone a note, and the feed of shared meals and ideas.

import { sendNote, listShares, deleteShare } from "../social.js";
import { t, formatNumber } from "../i18n.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const title = (s) => String(s ?? "").replace(/(^|[-_])([a-z])/g, (_, sep, c) => (sep ? " " : "") + c.toUpperCase());

export function agoLabel(iso, now = Date.now()) {
  const mins = Math.max(0, Math.round((now - Date.parse(iso)) / 60000));
  if (mins < 2) return t("social.ago.now");
  if (mins < 60) return t("social.ago.m", { n: mins });
  const h = Math.round(mins / 60);
  if (h < 24) return t("social.ago.h", { n: h });
  return t("social.ago.d", { n: Math.round(h / 24) });
}

/** Compose sheet for a note to one person. */
export async function openNoteSheet(to) {
  const { openSheet, navBar, wireNavBar } = await import("./sheet.js");
  openSheet({
    render(panel, close) {
      panel.innerHTML = `
        ${navBar({ title: t("social.noteTo", { name: title(to) }), leading: { label: t("app.cancel") }, trailing: { label: t("social.send"), bold: true, disabled: true } })}
        <div class="sheet-panel-body">
          <textarea class="describe-textarea note-input" id="note-input" rows="4" maxlength="200" placeholder="${t("social.notePlaceholder")}"></textarea>
          <div class="note-meta"><span id="note-count">0/200</span><span>${t("social.noteHint")}</span></div>
          <div class="voice-msg" id="note-err"></div>
        </div>`;
      const input = panel.querySelector("#note-input");
      const sendBtn = panel.querySelector('[data-nav="trailing"]');
      input.addEventListener("input", () => {
        panel.querySelector("#note-count").textContent = `${input.value.length}/200`;
        sendBtn.disabled = input.value.trim() === "";
      });
      wireNavBar(panel, {
        onLeading: () => close(),
        onTrailing: async () => {
          sendBtn.disabled = true;
          const out = await sendNote(to, input.value);
          if (!out.ok) {
            panel.querySelector("#note-err").textContent = out.message || t("errors.generic");
            sendBtn.disabled = false;
            return;
          }
          close();
          toast(t("social.sent", { name: title(to) }));
        },
      });
      setTimeout(() => input.focus(), 300);
    },
  });
}

function toast(text) {
  const el = document.createElement("div");
  el.className = "undo-toast";
  el.innerHTML = `<span class="undo-text">${esc(text)}</span>`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

/**
 * Renders the Shared feed into `host`.
 * @param {{me:string, people:Array<{owner:string, avatar?:string}>, colors:string[]}} ctx
 */
export async function renderFeed(host, { me, people, colors, group = null }) {
  const nameOf = (owner) => people.find((p) => p.owner === owner)?.name || title(owner);
  host.innerHTML = `<h2 class="tg-h2">${t("social.shared")}</h2><div class="feed-list"><p class="tg-note">…</p></div>`;
  const list = host.querySelector(".feed-list");
  const out = await listShares(group);
  if (!out.ok) { list.innerHTML = `<p class="tg-note">${esc(out.message || t("errors.generic"))}</p>`; return; }
  if (out.shares.length === 0) { list.innerHTML = `<p class="tg-note">${t("social.shareEmpty")}</p>`; return; }

  const colorOf = (owner) => colors[Math.max(0, people.findIndex((p) => p.owner === owner)) % colors.length];
  const avatarOf = (owner) => people.find((p) => p.owner === owner)?.avatar ?? null;

  list.innerHTML = out.shares.map((s) => {
    const d = s.data ?? {};
    const mine = s.owner === me;
    const av = avatarOf(s.owner);
    return `
      <article class="feed-card" data-id="${esc(s.id)}">
        <header class="feed-head">
          <span class="feed-av" style="--av:${colorOf(s.owner)}">${av ? `<img src="${av}" alt="">` : esc(nameOf(s.owner).slice(0, 1))}</span>
          <span class="feed-who">${esc(nameOf(s.owner))}</span>
          <span class="feed-kind">${s.kind === "idea" ? t("social.idea") : t("social.meal")}</span>
          <span class="feed-when">${agoLabel(s.created_at)}</span>
        </header>
        ${d.photo ? `<img class="feed-photo" src="${d.photo}" alt="">` : ""}
        <div class="feed-name">${esc(d.name)}</div>
        <div class="feed-macros">${formatNumber(d.calories)} kcal · ${formatNumber(d.proteinG)} g protein${d.minutes ? ` · ${formatNumber(d.minutes)} min` : ""}</div>
        ${d.note ? `<div class="feed-note">“${esc(d.note)}”</div>` : ""}
        ${s.kind === "idea" && (d.ingredients?.length || d.steps?.length) ? `
          <details class="feed-recipe"><summary>${t("social.recipe")}</summary>
            <ul>${(d.ingredients ?? []).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
            <ol>${(d.steps ?? []).map((x) => `<li>${esc(x)}</li>`).join("")}</ol>
          </details>` : ""}
        <footer class="feed-actions">
          <button type="button" class="feed-btn is-primary" data-log="${esc(s.id)}">${t("social.logThis")}</button>
          ${mine ? `<button type="button" class="feed-btn" data-del="${esc(s.id)}">${t("social.remove")}</button>` : ""}
        </footer>
      </article>`;
  }).join("");

  list.querySelectorAll("[data-log]").forEach((b) => b.addEventListener("click", async () => {
    const s = out.shares.find((x) => x.id === b.dataset.log);
    if (!s) return;
    const store = await import("../store.js");
    const d = s.data ?? {};
    store.addFoodEntry({
      name: d.name, calories: d.calories, proteinG: d.proteinG, carbsG: d.carbsG, fatG: d.fatG,
      source: "manual", photoDataUrl: d.photo ?? null,
      analysisItems: Array.isArray(d.items) && d.items.length ? d.items : null,
      timestamp: Date.now(),
    });
    b.textContent = `✓ ${t("social.logged")}`;
    b.disabled = true;
  }));
  list.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", async () => {
    b.disabled = true;
    await deleteShare(b.dataset.del);
    b.closest(".feed-card")?.remove();
  }));
}
