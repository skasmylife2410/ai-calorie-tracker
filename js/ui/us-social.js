// us-social.js — the parts of the Us tab that are about each other rather than numbers:
// writing someone a note, and the feed of shared meals and ideas.

import { safeSrc } from "../safe-src.js";
import { sendNote, listShares, deleteShare, addComment, deleteComment, createPost, POST_MAX, COMMENT_MAX } from "../social.js";
import { t, formatNumber } from "../i18n.js";
import { icon } from "./icons.js";
import { gifImgHtml, gifUrl } from "../gif.js";
import { openGifPicker } from "./gif-picker.js";

/** The "GIF" mark on buttons: the letters in a small rounded box, drawn like the other glyphs. */
export const GIF_GLYPH = `<span class="gif-glyph" aria-hidden="true">GIF</span>`;

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
          <div class="note-gif" id="note-gif" hidden></div>
          <div class="note-tools"><button type="button" class="feed-btn note-gif-btn" id="note-gif-btn">${GIF_GLYPH}<span class="note-gif-label">${t("gif.add")}</span></button></div>
          <div class="note-meta"><span id="note-count">0/200</span><span>${t("social.noteHint")}</span></div>
          <div class="voice-msg" id="note-err"></div>
        </div>`;
      const input = panel.querySelector("#note-input");
      const sendBtn = panel.querySelector('[data-nav="trailing"]');
      let gif = null;
      const refresh = () => {
        panel.querySelector("#note-count").textContent = `${input.value.length}/200`;
        sendBtn.disabled = input.value.trim() === "" && !gif;
        const box = panel.querySelector("#note-gif");
        box.hidden = !gif;
        box.innerHTML = gif ? `${gifImgHtml(gif, { cls: "note-gif-img" })}<button type="button" class="pc-unphoto" id="note-ungif" aria-label="${t("gif.remove")}">${icon("xmark", { size: 12 })}</button>` : "";
        box.querySelector("#note-ungif")?.addEventListener("click", () => { gif = null; refresh(); });
        panel.querySelector(".note-gif-label").textContent = gif ? t("gif.change") : t("gif.add");
      };
      input.addEventListener("input", refresh);
      panel.querySelector("#note-gif-btn").addEventListener("click", async () => {
        const g = await openGifPicker();
        if (g) { gif = g; refresh(); }
      });
      wireNavBar(panel, {
        onLeading: () => close(),
        onTrailing: async () => {
          sendBtn.disabled = true;
          const out = await sendNote(to, input.value, gif);
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

/** Reads a picked image file as a data URL (the caller shrinks it before upload). */
function readPhoto(file) {
  return new Promise((resolve) => {
    if (!file) return resolve(null);
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

const COMMENTS_SHOWN = 2; // the latest few sit under each post; "View all" opens the rest in place

/**
 * Renders the Shared feed into `host`. Each post reads as a post: who and when, the photo at full
 * width, the meal or caption, then its conversation. The latest comments are part of the post
 * (no hidden panel), every post has its own "Add a comment" line, and a comment can carry a photo.
 * @param {{me:string, people:Array<{owner:string, avatar?:string}>, colors:string[], group?:string|null, groupName?:string}} ctx
 */
export async function renderFeed(host, { me, people, colors, group = null, groupName = "" }) {
  const nameOf = (owner) => people.find((p) => p.owner === owner)?.name || title(owner);
  host.innerHTML = `<div class="post-compose" id="post-compose"></div><p class="feed-rule">${t("social.feedRule")}</p><div class="feed-list"><p class="tg-note">…</p></div>`;
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
  const expanded = new Set(); // posts whose whole thread is open
  const drafts = new Map();   // shareId -> { text, photo } so a redraw never loses what you typed

  const avHtml = (owner, cls = "feed-av") => {
    const av = avatarOf(owner);
    return `<span class="${cls}" style="--av:${colorOf(owner)}">${av ? `<img src="${safeSrc(av)}" alt="">` : esc(nameOf(owner).slice(0, 1))}</span>`;
  };

  const commentHtml = (c) => `
    <li class="fc-item" data-cid="${esc(c.id)}">
      ${avHtml(c.owner, "fc-av")}
      <div class="fc-body">
        ${c.body ? `<p class="fc-text"><b class="fc-who">${esc(nameOf(c.owner))}</b> ${esc(c.body)}</p>` : `<p class="fc-text"><b class="fc-who">${esc(nameOf(c.owner))}</b></p>`}
        ${c.photo ? `<img class="fc-photo" src="${safeSrc(c.photo)}" alt="${t("social.photoBy", { name: esc(nameOf(c.owner)) })}" loading="lazy">` : ""}
        ${c.photoHidden ? `<p class="fc-hidden">${t("social.photoHidden")}</p>` : ""}
        ${!c.photo && c.gif ? gifImgHtml(c.gif, { cls: "fc-photo fc-gif", alt: t("gif.by", { name: nameOf(c.owner) }) }) : ""}
        <small class="fc-when">${agoLabel(c.created_at)}</small>
      </div>
      ${c.owner === me ? `<button type="button" class="fc-del" data-cdel="${esc(c.id)}" aria-label="${t("social.deleteComment")}">${icon("xmark", { size: 12 })}</button>` : ""}
    </li>`;

  const addCommentHtml = (s, count) => {
    const d = drafts.get(s.id) ?? {};
    return `
      <div class="fc-compose${d.photo || d.gif ? " has-photo" : ""}" data-compose="${esc(s.id)}">
        ${avHtml(me, "fc-av")}
        <input type="text" class="fc-input" maxlength="${COMMENT_MAX}" value="${esc(d.text ?? "")}"
          placeholder="${count ? t("social.commentPlaceholder") : t("social.firstComment")}" aria-label="${t("social.commentPlaceholder")}">
        ${d.photo ? `<span class="fc-thumb"><img src="${safeSrc(d.photo)}" alt=""><button type="button" class="fc-thumb-x" data-unphoto="${esc(s.id)}" aria-label="${t("social.removePhoto")}">${icon("xmark", { size: 10 })}</button></span>` : ""}
        ${!d.photo && d.gif ? `<span class="fc-thumb"><img src="${gifUrl(d.gif)}" alt="" referrerpolicy="no-referrer"><button type="button" class="fc-thumb-x" data-unphoto="${esc(s.id)}" aria-label="${t("gif.remove")}">${icon("xmark", { size: 10 })}</button></span>` : ""}
        <input type="file" accept="image/*" class="fc-file" hidden>
        <button type="button" class="fc-cam fc-gifbtn" data-cgif="${esc(s.id)}" aria-label="${t("gif.add")}">${GIF_GLYPH}</button>
        <button type="button" class="fc-cam" data-cphoto="${esc(s.id)}" aria-label="${t("social.addPhotoLabel")}">${icon("cameraFill", { size: 17 })}</button>
        <button type="button" class="fc-send" data-send="${esc(s.id)}" aria-label="${t("social.send")}" ${d.text?.trim() || d.photo || d.gif ? "" : "hidden"}>${icon("chevronRight", { size: 14 })}</button>
      </div>
      <div class="fc-err" role="status"></div>`;
  };

  const cardHtml = (s) => {
    const d = s.data ?? {};
    const mine = s.owner === me;
    const comments = s.comments ?? [];
    const isPost = s.kind === "post";
    const all = expanded.has(s.id);
    const shown = all ? comments : comments.slice(-COMMENTS_SHOWN);
    const hiddenCount = comments.length - shown.length;
    return `
      <article class="feed-card${isPost ? " is-post" : ""}${d.photo || d.gif ? "" : " no-photo"}" data-id="${esc(s.id)}">
        <header class="feed-head">
          ${avHtml(s.owner)}
          <span class="feed-who">${esc(nameOf(s.owner))}</span>
          <span class="feed-when">${agoLabel(s.created_at)}</span>
          ${mine ? `<button type="button" class="feed-del" data-del="${esc(s.id)}" aria-label="${t("social.deletePost")}">${icon("trashFill", { size: 15 })}</button>` : ""}
        </header>
        ${d.photo ? `<img class="feed-photo" src="${safeSrc(d.photo)}" alt="${esc(d.name || d.text || "")}" loading="lazy">` : ""}
        ${d.photoHidden ? `<p class="fc-hidden feed-photo-hidden">${t("social.photoHidden")}</p>` : ""}
        ${!d.photo && d.gif ? gifImgHtml(d.gif, { cls: "feed-photo feed-gif", size: "large", alt: t("gif.by", { name: nameOf(s.owner) }) }) : ""}
        <div class="feed-main">
          ${isPost ? (d.text ? `<p class="feed-text">${esc(d.text)}</p>` : "") : `
            <div class="feed-title"><span class="feed-name">${esc(d.name)}</span><span class="feed-kcal">${formatNumber(d.calories)}</span><span class="feed-unit">kcal</span></div>
            <div class="feed-macros">
              <span><i style="background:var(--sc-protein)"></i>${formatNumber(d.proteinG)} g ${t("home.proteinShort").toLowerCase()}</span>
              <span><i style="background:var(--sc-carbs)"></i>${formatNumber(d.carbsG)} g ${t("home.carbsShort").toLowerCase()}</span>
              <span><i style="background:var(--sc-fat)"></i>${formatNumber(d.fatG)} g ${t("home.fatShort").toLowerCase()}</span>
            </div>
            ${d.note ? `<p class="feed-note">${esc(d.note)}</p>` : ""}`}
          <div class="feed-actions">
            <span class="feed-count">${icon("textBubbleFill", { size: 15 })}${comments.length ? t("social.commentsCount", { n: comments.length }) : t("social.comment")}</span>
            ${isPost ? "" : `<button type="button" class="feed-btn feed-log" data-log="${esc(s.id)}">${icon("plus", { size: 12 })} ${t("social.logThis")}</button>`}
          </div>
          ${hiddenCount > 0 ? `<button type="button" class="fc-all" data-all="${esc(s.id)}">${t("social.viewAll", { n: comments.length })}</button>` : ""}
          ${all && comments.length > COMMENTS_SHOWN ? `<button type="button" class="fc-all" data-all="${esc(s.id)}">${t("social.showLess")}</button>` : ""}
          ${shown.length ? `<ul class="fc-list">${shown.map(commentHtml).join("")}</ul>` : ""}
          ${addCommentHtml(s, comments.length)}
        </div>
      </article>`;
  };

  const drawComposer = () => {
    if (postedToday()) {
      composer.innerHTML = `<div class="pc-done">${t("social.postedToday")}</div>`;
      return;
    }
    let photo = null;
    let gif = null; // a photo or a GIF: picking one replaces the other
    composer.innerHTML = `
      <div class="pc-line">
        ${avHtml(me, "fc-av pc-av")}
        <textarea class="pc-text" rows="1" maxlength="${POST_MAX}" placeholder="${groupName ? t("social.sharePlaceholder", { group: esc(groupName) }) : t("social.postPlaceholder")}" aria-label="${t("social.postPlaceholder")}"></textarea>
        <input type="file" accept="image/*" class="pc-file" hidden>
        <button type="button" class="pc-photo pc-gif" aria-label="${t("gif.add")}">${GIF_GLYPH}</button>
        <button type="button" class="pc-photo" aria-label="${t("social.addPhotoLabel")}">${icon("cameraFill", { size: 17 })}</button>
      </div>
      <div class="pc-preview-wrap" hidden><img class="pc-preview" alt=""><button type="button" class="pc-unphoto" aria-label="${t("social.removePhoto")}">${icon("xmark", { size: 12 })}</button></div>
      <div class="pc-row" hidden>
        <span class="pc-count"><span class="pc-n">0</span>/${POST_MAX}</span>
        <button type="button" class="feed-btn is-primary pc-send" disabled>${t("social.post")}</button>
      </div>
      <div class="fc-err pc-err" role="status"></div>`;
    const text = composer.querySelector(".pc-text");
    const file = composer.querySelector(".pc-file");
    const wrap = composer.querySelector(".pc-preview-wrap");
    const preview = composer.querySelector(".pc-preview");
    const row = composer.querySelector(".pc-row");
    const sendBtn = composer.querySelector(".pc-send");
    const refresh = () => {
      composer.querySelector(".pc-n").textContent = String(text.value.length);
      sendBtn.disabled = !text.value.trim() && !photo && !gif;
      const active = Boolean(text.value.trim() || photo || gif || document.activeElement === text);
      row.hidden = !active;
      composer.classList.toggle("is-open", active);
      text.rows = active ? 2 : 1;
    };
    text.addEventListener("input", refresh);
    text.addEventListener("focus", refresh);
    text.addEventListener("blur", () => setTimeout(refresh, 150));
    composer.querySelector(".pc-photo:not(.pc-gif)").addEventListener("click", () => file.click());
    file.addEventListener("change", async () => {
      photo = await readPhoto(file.files?.[0]);
      file.value = "";
      if (photo) { gif = null; preview.src = photo; wrap.hidden = false; wrap.classList.remove("is-gif"); }
      refresh();
    });
    composer.querySelector(".pc-gif").addEventListener("click", async () => {
      const g = await openGifPicker();
      if (!g) return;
      gif = g;
      photo = null;
      preview.src = gifUrl(g);
      preview.referrerPolicy = "no-referrer";
      wrap.hidden = false;
      wrap.classList.add("is-gif");
      refresh();
    });
    composer.querySelector(".pc-unphoto").addEventListener("click", () => { photo = null; gif = null; wrap.hidden = true; preview.removeAttribute("src"); refresh(); });
    sendBtn.addEventListener("click", async () => {
      sendBtn.disabled = true;
      sendBtn.textContent = "…";
      const res = await createPost(text.value, photo, group, gif);
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

  const redrawKeepingFocus = (shareId) => {
    draw();
    if (shareId) list.querySelector(`[data-compose="${CSS.escape(shareId)}"] .fc-input`)?.focus();
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
    list.querySelectorAll("[data-all]").forEach((b) => b.addEventListener("click", () => {
      const id = b.dataset.all;
      if (expanded.has(id)) expanded.delete(id); else expanded.add(id);
      draw();
    }));
    list.querySelectorAll("[data-compose]").forEach((row) => {
      const id = row.dataset.compose;
      const input = row.querySelector(".fc-input");
      const file = row.querySelector(".fc-file");
      const sendBtn = row.querySelector(".fc-send");
      const err = row.nextElementSibling;
      const draft = () => drafts.get(id) ?? {};
      const update = (patch) => drafts.set(id, { ...draft(), ...patch });
      input.addEventListener("input", () => {
        update({ text: input.value });
        sendBtn.hidden = !input.value.trim() && !draft().photo && !draft().gif;
      });
      row.querySelector("[data-cphoto]").addEventListener("click", () => file.click());
      file.addEventListener("change", async () => {
        const photo = await readPhoto(file.files?.[0]);
        file.value = "";
        if (!photo) return;
        update({ photo, gif: null });
        redrawKeepingFocus(id);
      });
      row.querySelector("[data-cgif]").addEventListener("click", async () => {
        const gif = await openGifPicker();
        if (!gif) return;
        update({ gif, photo: null });
        redrawKeepingFocus(id);
      });
      row.querySelector("[data-unphoto]")?.addEventListener("click", () => { update({ photo: null, gif: null }); redrawKeepingFocus(id); });
      const send = async () => {
        const { text = "", photo = null, gif = null } = draft();
        if (!text.trim() && !photo && !gif) return;
        sendBtn.disabled = true;
        input.disabled = true;
        const res = await addComment(id, text.trim(), photo, gif);
        if (!res.ok) {
          err.textContent = res.message || (res.errorType === "photo" ? t("social.photoFailed") : t("errors.generic"));
          sendBtn.disabled = false;
          input.disabled = false;
          return;
        }
        const s = out.shares.find((x) => x.id === id);
        s.comments = [...(s.comments ?? []), res.comment];
        drafts.delete(id);
        redrawKeepingFocus(id);
      };
      sendBtn.addEventListener("click", send);
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
