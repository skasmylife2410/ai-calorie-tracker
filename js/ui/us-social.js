// us-social.js — the parts of the Us tab that are about each other rather than numbers:
// writing someone a note, and the feed of shared meals and ideas.

import { safeSrc } from "../safe-src.js";
import { sendNote, listShares, deleteShare, addComment, deleteComment, createPost, POST_MAX, COMMENT_MAX } from "../social.js";
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
  host.innerHTML = `<h2 class="tg-h2">${t("social.shared")}</h2><div class="post-compose" id="post-compose"></div><div class="feed-list"><p class="tg-note">…</p></div><p class="feed-rule">${t("social.feedRule")}</p>`;
  const list = host.querySelector(".feed-list");
  const composer = host.querySelector("#post-compose");
  const out = await listShares(group);
  if (!out.ok) { list.innerHTML = `<p class="tg-note">${esc(out.message || t("errors.generic"))}</p>`; return; }
  const FEED_SHOWN = 5; // a small block: the newest few, the rest behind "Show more"
  let showAll = false;
  const localDay = (iso) => new Date(iso).toDateString();
  const postedToday = () => out.shares.some((s) => s.owner === me && localDay(s.created_at) === new Date().toDateString());

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
    const isPost = s.kind === "post";
    return `
      <article class="feed-card${isPost ? " is-post" : ""}${d.photo ? "" : " no-photo"}" data-id="${esc(s.id)}">
        ${d.photo ? `<img class="feed-thumb" src="${safeSrc(d.photo)}" alt="${esc(d.name || d.text || "")}" loading="lazy">` : ""}
        <div class="feed-main">
          <header class="feed-head">
            <span class="feed-av" style="--av:${colorOf(s.owner)}">${av ? `<img src="${safeSrc(av)}" alt="">` : esc(nameOf(s.owner).slice(0, 1))}</span>
            <span class="feed-who">${esc(nameOf(s.owner))}</span>
            <span class="feed-when">${agoLabel(s.created_at)}</span>
          </header>
          ${isPost ? `<div class="feed-text">${esc(d.text)}</div>` : `
          <div class="feed-name">${esc(d.name)}</div>
          <div class="feed-macros">${formatNumber(d.calories)} kcal, ${formatNumber(d.proteinG)} g protein</div>
          ${d.note ? `<div class="feed-note">“${esc(d.note)}”</div>` : ""}`}
          <footer class="feed-actions">
            ${isPost ? "" : `<button type="button" class="feed-btn is-primary" data-log="${esc(s.id)}">${t("social.logThis")}</button>`}
            <button type="button" class="feed-btn" data-talk="${esc(s.id)}" aria-expanded="${isOpen}">💬 ${comments.length || ""}</button>
            ${mine ? `<button type="button" class="feed-btn" data-del="${esc(s.id)}">${t("social.remove")}</button>` : ""}
          </footer>
        </div>
        ${isOpen ? `
          <div class="feed-comments">
            <ul class="fc-list">${comments.map(commentHtml).join("") || `<li class="fc-empty">${t("social.noComments")}</li>`}</ul>
            <div class="fc-compose">
              <input type="text" class="fc-input" maxlength="${COMMENT_MAX}" placeholder="${t("social.commentPlaceholder")}" aria-label="${t("social.commentPlaceholder")}">
              <button type="button" class="feed-btn is-primary" data-send="${esc(s.id)}">${t("social.send")}</button>
            </div>
            <div class="fc-count"><span class="fc-n">0</span>/${COMMENT_MAX}</div>
            <div class="fc-err" role="status"></div>
          </div>` : ""}
      </article>`;
  };

  const drawComposer = () => {
    if (postedToday()) {
      composer.innerHTML = `<div class="pc-done">${t("social.postedToday")}</div>`;
      return;
    }
    let photo = null;
    composer.innerHTML = `
      <textarea class="pc-text" rows="2" maxlength="${POST_MAX}" placeholder="${t("social.postPlaceholder")}" aria-label="${t("social.postPlaceholder")}"></textarea>
      <div class="pc-row">
        <input type="file" accept="image/*" class="pc-file" hidden>
        <button type="button" class="feed-btn pc-photo">${t("social.addPhoto")}</button>
        <img class="pc-preview" alt="" hidden>
        <span class="pc-count"><span class="pc-n">0</span>/${POST_MAX}</span>
        <button type="button" class="feed-btn is-primary pc-send" disabled>${t("social.post")}</button>
      </div>
      <div class="fc-err pc-err" role="status"></div>`;
    const text = composer.querySelector(".pc-text");
    const file = composer.querySelector(".pc-file");
    const preview = composer.querySelector(".pc-preview");
    const sendBtn = composer.querySelector(".pc-send");
    const refresh = () => {
      composer.querySelector(".pc-n").textContent = String(text.value.length);
      sendBtn.disabled = !text.value.trim() && !photo;
    };
    text.addEventListener("input", refresh);
    composer.querySelector(".pc-photo").addEventListener("click", () => file.click());
    file.addEventListener("change", () => {
      const f = file.files?.[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => { photo = String(reader.result); preview.src = photo; preview.hidden = false; refresh(); };
      reader.readAsDataURL(f);
    });
    sendBtn.addEventListener("click", async () => {
      sendBtn.disabled = true;
      sendBtn.textContent = "…";
      const res = await createPost(text.value, photo, group);
      if (!res.ok) {
        composer.querySelector(".pc-err").textContent = res.message || t("errors.generic");
        sendBtn.textContent = t("social.post");
        refresh();
        return;
      }
      const fresh = await listShares(group);
      if (fresh.ok) out.shares = fresh.shares;
      draw();
    });
  };

  const draw = () => {
    drawComposer();
    if (out.shares.length === 0) { list.innerHTML = `<p class="tg-note">${t("social.shareEmpty")}</p>`; return; }
    const shown = showAll ? out.shares : out.shares.slice(0, FEED_SHOWN);
    list.innerHTML = shown.map(cardHtml).join("") +
      (out.shares.length > shown.length ? `<button type="button" class="feed-more" id="feed-more">${t("social.showMore", { n: out.shares.length - shown.length })}</button>` : "");
    list.querySelector("#feed-more")?.addEventListener("click", () => { showAll = true; draw(); });
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
      input.addEventListener("input", () => { card.querySelector(".fc-n").textContent = String(input.value.length); });
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
