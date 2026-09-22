// describe.js — Describe Meal sheet (DescribeMealView.swift), SPEC-UI.md §10.
// A dumb text collector — fire-and-forget; errors surface later on the pending card.

import * as queue from "../queue.js";
import { openSheet, navBar, wireNavBar } from "./sheet.js";
import { startDictation, voiceSupport } from "./voice.js";
import { icon } from "./icons.js";
import { t, currentLanguage } from "../i18n.js";

const CHAR_CAP = 500;
const COUNTER_SHOW_AT = 400;

/** @param {{voice?: boolean, timestamp?: number}} opts  voice: start listening straight away */
export function openDescribeMealSheet({ voice = false, timestamp = null } = {}) {
  let dictation = null;
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
        analyzeBtn.disabled = textarea.value.trim() === "";
      });

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
          if (trimmed === "") return;
          queue.enqueueText(trimmed, timestamp ? { timestamp } : undefined);
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
