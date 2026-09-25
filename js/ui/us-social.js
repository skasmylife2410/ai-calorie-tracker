// us-social.js — the parts of the Us tab that are about each other rather than numbers:
// writing someone a note, and the feed of shared meals and ideas.

import { sendNote, listShares, deleteShare, addComment, deleteComment } from "../social.js";
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
 * Renders the Shared feed into `host`: compact photo posts, each with its comments.
 * @param {{me:string, people:Array<{owner:string, avatar?:string}>, colors:string[]}} ctx
 */
export async function renderFeed(host, { me, people, colors, group = null }) {
  const nameOf = (owner) => people.find((p) => p.owner === owner)?.name || title(owner);
  host.innerHTML = `<h2 class="tg-h2">${t("social.shared")}</h2><p class="feed-rule">${t("social.feedRule")}</p><div class="feed-list"><p class="tg-note">…</p></div>`;
  const list = host.querySelector(".feed-list");
  const out = await listShares(group);
  if (!out.ok) { list.innerHTML = `<p class="tg-note">${esc(out.message || t("errors.generic"))}</p>`; return; }
  if (out.shares.length === 0) { list.innerHTML = `<p class="tg-note">${t("social.shareEmpty")}</p>`; return; }

  const colorOf = (owner) => colors[Math.max(0, people.findIndex((p) => p.owner === owner)) % colors.length];
  const avatarOf = (owner) => people.find((p) => p.owner === owner)?.avatar ?? null;
  const open = new Set();

  const commentHtml = (c) => `
    <li class="fc-item" data-cid="${esc(c.id)}">
      <span class="fc-who">${esc(nameOf(c.owner))}</span> ${esc(c.body)}
      ${c.owner === me ? `<button type="button" class="fc-del" data-cdel="${esc(c.id)}" aria-label="${t("social.deleteComment")}">×</button>` : ""}
    </li>`;

  const cardHtml = (s) => {
    const d = s.data ?? {};
    const mine = s.owner === me;
    const av = avatarOf(s.owner);
    const comments = s.comments ?? [];
    const isOpen = open.has(s.id);
    return `
      <article class="feed-card" data-id="${esc(s.id)}">
        <img class="feed-thumb" src="${d.photo}" alt="${esc(d.name)}" loading="lazy">
        <div class="feed-main">
          <header class="feed-head">
            <span class="feed-av" style="--av:${colorOf(s.owner)}">${av ? `<img src="${av}" alt="">` : esc(nameOf(s.owner).slice(0, 1))}</span>
            <span class="feed-who">${esc(nameOf(s.owner))}</span>
            <span class="feed-when">${agoLabel(s.created_at)}</span>
          </header>
          <div class="feed-name">${esc(d.name)}</div>
          <div class="feed-macros">${formatNumber(d.calories)} kcal, ${formatNumber(d.proteinG)} g protein</div>
          ${d.note ? `<div class="feed-note">“${esc(d.note)}”</div>` : ""}
          <footer class="feed-actions">
            <button type="button" class="feed-btn is-primary" data-log="${esc(s.id)}">${t("social.logThis")}</button>
            <button type="button" class="feed-btn" data-talk="${esc(s.id)}" aria-expanded="${isOpen}">💬 ${comments.length || ""}</button>
            ${mine ? `<button type="button" class="feed-btn" data-del="${esc(s.id)}">${t("social.remove")}</button>` : ""}
          </footer>
        </div>
        ${isOpen ? `
          <div class="feed-comments">
            <ul class="fc-list">${comments.map(commentHtml).join("") || `<li class="fc-empty">${t("social.noComments")}</li>`}</ul>
            <div class="fc-compose">
              <input type="text" class="fc-input" maxlength="200" placeholder="${t("social.commentPlaceholder")}" aria-label="${t("social.commentPlaceholder")}">
              <button type="button" class="feed-btn is-primary" data-send="${esc(s.id)}">${t("social.send")}</button>
            </div>
            <div class="fc-err" role="status"></div>
          </div>` : ""}
      </article>`;
  };

  const draw = () => {
    list.innerHTML = out.shares.map(cardHtml).join("");
    wire();
  };

  const wire = () => {
    list.querySelectorAll("[data-log]").forEach((b) => b.addEventListener("click", async () => {
      const s = out.shares.find((x) => x.id === b.dataset.log);
      if (!s) return;
      const store = await import("../store.js");
      const d = s.data ?? {};
      store.addFoodEntry({
        name: d.name, calories: d.calories, proteinG: d.proteinG, carbsG: d.carbsG, fatG: d.fatG,
        micros: d.micros ?? null,
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
      out.shares = out.shares.filter((x) => x.id !== b.dataset.del);
      draw();
    }));
    list.querySelectorAll("[data-talk]").forEach((b) => b.addEventListener("click", () => {
      const id = b.dataset.talk;
      if (open.has(id)) open.delete(id); else open.add(id);
      draw();
      if (open.has(id)) list.querySelector(`[data-id="${CSS.escape(id)}"] .fc-input`)?.focus();
    }));
    list.querySelectorAll("[data-send]").forEach((b) => {
      const card = b.closest(".feed-card");
      const input = card.querySelector(".fc-input");
      const send = async () => {
        const text = input.value.trim();
        if (!text) return;
        b.disabled = true;
        const res = await addComment(b.dataset.send, text);
        if (!res.ok) {
          card.querySelector(".fc-err").textContent = res.message || t("errors.generic");
          b.disabled = false;
          return;
        }
        const s = out.shares.find((x) => x.id === b.dataset.send);
        s.comments = [...(s.comments ?? []), res.comment];
        draw();
        list.querySelector(`[data-id="${CSS.escape(s.id)}"] .fc-input`)?.focus();
      };
      b.addEventListener("click", send);
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") send(); });
    });
    list.querySelectorAll("[data-cdel]").forEach((b) => b.addEventListener("click", async () => {
      b.disabled = true;
      const res = await deleteComment(b.dataset.cdel);
      if (!res.ok) { b.disabled = false; return; }
      for (const s of out.shares) s.comments = (s.comments ?? []).filter((c) => c.id !== b.dataset.cdel);
      draw();
    }));
  };

  draw();
}
