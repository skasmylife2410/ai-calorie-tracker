// describe.js — Describe Meal sheet (DescribeMealView.swift), SPEC-UI.md §10.
// A dumb text collector — fire-and-forget; errors surface later on the pending card.

import * as queue from "../queue.js";
import * as store from "../store.js";
import { safeSrc } from "../safe-src.js";
import { resizeImage, scanPreset } from "../resize.js";
import { openSheet, navBar, wireNavBar } from "./sheet.js";
import { startDictation, voiceSupport } from "./voice.js";
import { icon } from "./icons.js";
import { t, currentLanguage } from "../i18n.js";

const CHAR_CAP = 500;
const COUNTER_SHOW_AT = 400;

// Two optional photos go with the words: one of the meal, which fills in what the words leave
// out (foods not mentioned, amounts not given) but never changes an amount they give, and one of
// the leftovers, taken off once the meal is known (js/queue.js enqueueText).
const PHOTO_SLOTS = [
  { id: "meal", icon: "cameraFill" },
  { id: "left", icon: "plateHalf" },
];

/**
 * @param {{voice?: boolean, timestamp?: number, onText?: (text:string, photos:{photoDataUrl:string|null, leftoversDataUrl:string|null})=>void}} opts
 *   voice: start listening straight away; onText: hand the words (and photos) back, for adding
 *   to a meal being edited, instead of logging a new meal
 */
export function openDescribeMealSheet({ voice = false, timestamp = null, onText = null } = {}) {
  let dictation = null;
  const photos = { meal: null, left: null }; // data URLs
  let preparing = 0; // photos being resized
  openSheet({
    render(panel, close) {
      panel.innerHTML = `
        ${navBar({
          title: t("voice.title"),
          leading: { label: t("app.cancel") },
          trailing: { label: t("voice.analyze"), bold: true, disabled: true },
        })}
        <div class="sheet-panel-body">
          <div class="describe-body">
            <div class="describe-subhead">${t("voice.subhead")}</div>
            <textarea class="describe-textarea" id="describe-input" rows="4"
              placeholder="${t("voice.placeholder")}"></textarea>
            <div class="describe-counter hidden" id="describe-counter"></div>
            ${voiceSupport().any ? `
              <button type="button" class="voice-btn" id="voice-btn" aria-pressed="false">
                <span class="voice-icon">${icon("mic", { size: 22 })}</span>
                <span class="voice-label" id="voice-label">${t("voice.start")}</span>
              </button>
              <div class="voice-msg" id="voice-msg"></div>` : ""}
            <div class="describe-footer-tip">${voiceSupport().any ? t("voice.hint") : t("voice.tip")}</div>
            <div class="describe-photos" id="describe-photos"></div>
          </div>
        </div>
      `;

      const textarea = panel.querySelector("#describe-input");
      const counter = panel.querySelector("#describe-counter");
      const analyzeBtn = panel.querySelector('[data-nav="trailing"]');

      textarea.addEventListener("input", () => {
        if (textarea.value.length > CHAR_CAP) {
          textarea.value = textarea.value.slice(0, CHAR_CAP);
        }
        const len = textarea.value.length;
        if (len >= COUNTER_SHOW_AT) {
          counter.classList.remove("hidden");
          counter.textContent = `${len}/${CHAR_CAP}`;
          counter.classList.toggle("at-limit", len >= CHAR_CAP);
        } else {
          counter.classList.add("hidden");
        }
        analyzeBtn.disabled = textarea.value.trim() === "" || preparing > 0;
      });

      // --- photos (optional) ---------------------------------------------------
      const photosEl = panel.querySelector("#describe-photos");
      const drawPhotos = () => {
        photosEl.innerHTML = `
          <div class="describe-photos-head">${t("descPhotos.title")}</div>
          <div class="describe-photo-row">
            ${PHOTO_SLOTS.map((p) => photos[p.id]
              ? `<div class="describe-photo is-set">
                   <img src="${safeSrc(photos[p.id])}" alt="">
                   <span class="describe-photo-text"><b>${t(`descPhotos.${p.id}`)}</b><small>${t("descPhotos.added")}</small></span>
                   <button type="button" class="describe-photo-x" data-photo-x="${p.id}" aria-label="${t("descPhotos.remove")}">${icon("xmark", { size: 13 })}</button>
                 </div>`
              : `<label class="describe-photo">
                   <span class="describe-photo-ic" aria-hidden="true">${icon(p.icon, { size: 18 })}</span>
                   <span class="describe-photo-text"><b>${t(`descPhotos.${p.id}`)}</b><small>${t(`descPhotos.${p.id}Sub`)}</small></span>
                   <input type="file" accept="image/*" data-photo="${p.id}" hidden>
                 </label>`).join("")}
          </div>
          ${preparing > 0 ? `<div class="describe-photos-note" role="status">${t("descPhotos.working")}</div>` : ""}
          <p class="describe-photos-note">${t("descPhotos.note")}</p>`;
        photosEl.querySelectorAll("[data-photo]").forEach((input) => input.addEventListener("change", async () => {
          const f = input.files?.[0];
          if (!f) return;
          preparing += 1;
          drawPhotos();
          textarea.dispatchEvent(new Event("input"));
          try {
            const { dataUrl } = await resizeImage(f, scanPreset(store.getProfile().scanQuality));
            photos[input.dataset.photo] = dataUrl;
          } catch { /* unreadable file: the slot stays empty */ }
          preparing -= 1;
          drawPhotos();
          textarea.dispatchEvent(new Event("input"));
        }));
        photosEl.querySelectorAll("[data-photo-x]").forEach((b) => b.addEventListener("click", () => {
          photos[b.dataset.photoX] = null;
          drawPhotos();
        }));
      };
      drawPhotos();

      // --- voice -------------------------------------------------------------
      const voiceBtn = panel.querySelector("#voice-btn");
      const voiceLabel = panel.querySelector("#voice-label");
      const voiceMsg = panel.querySelector("#voice-msg");
      let typedBefore = "";

      const setState = (state) => {
        const active = state === "listening" || state === "recording" || state === "transcribing";
        voiceBtn?.classList.toggle("is-active", active);
        voiceBtn?.setAttribute("aria-pressed", String(active));
        if (voiceLabel) voiceLabel.textContent = t(`voice.${state === "idle" ? "start" : state}`);
        if (!active) dictation = null;
      };
      const showError = (code) => {
        const key = { "voice-denied": "denied", "voice-unsupported": "unsupported", "voice-empty": "empty", "voice-failed": "failed" }[code];
        if (voiceMsg) voiceMsg.textContent = key ? t(`voice.${key}`) : code;
        setState("idle");
      };
      const toggleVoice = () => {
        if (dictation) { dictation.stop(); return; }
        if (voiceMsg) voiceMsg.textContent = "";
        typedBefore = textarea.value.trim();
        dictation = startDictation({
          lang: currentLanguage() === "es" ? "es" : "en",
          onState: setState,
          onError: showError,
          onText: (spoken) => {
            // what they say is added after anything already typed
            textarea.value = (typedBefore ? typedBefore + " " : "") + spoken;
            textarea.dispatchEvent(new Event("input"));
          },
        });
      };
      voiceBtn?.addEventListener("click", toggleVoice);

      wireNavBar(panel, {
        onLeading: () => { dictation?.stop(); close(); },
        onTrailing: () => {
          dictation?.stop();
          const trimmed = textarea.value.trim();
          if (trimmed === "" || preparing > 0) return;
          const extra = { photoDataUrl: photos.meal, leftoversDataUrl: photos.left };
          if (onText) onText(trimmed, extra);
          else queue.enqueueText(trimmed, { ...(timestamp ? { timestamp } : {}), ...extra });
          close();
        },
      });

      if (voice && voiceBtn) setTimeout(toggleVoice, 400);

      // Auto-focus on appear (spec: field is auto-focused) — but not when opened for voice,
      // where the keyboard would just cover the microphone.
      if (!voice) setTimeout(() => textarea.focus(), 350);
    },
  });
}
