// questions.js — when a meal analysis is under 50% sure, it asks up to two quick questions
// ("What's inside the wrap?", "Fried or grilled?") with answers to tap. Answering re-analyses the
// meal once with the same photo; "Keep the estimate" stops asking and keeps the best guess.

import { safeSrc } from "../safe-src.js";
import { t } from "../i18n.js";
import * as queue from "../queue.js";
import { openSheet, navBar, wireNavBar } from "./sheet.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** "62%": how sure the analysis is, for the small badge on a meal's picture. */
export const surePct = (entry) => (Number.isFinite(entry?.analysisConfidence) ? Math.round(entry.analysisConfidence * 100) : null);

export function sureBadgeHtml(entry, cls = "sure-badge") {
  const pct = surePct(entry);
  if (pct === null) return "";
  return `<span class="${cls}${pct < 50 ? " is-low" : ""}" title="${esc(t("ask.sureTitle", { pct }))}" aria-label="${esc(t("ask.sureTitle", { pct }))}">${pct}%</span>`;
}

let openFor = null; // entry id whose sheet is showing, so it never opens twice

export function openQuestionsSheet(entry, { onDone } = {}) {
  const questions = Array.isArray(entry?.analysisQuestions) ? entry.analysisQuestions : [];
  if (!questions.length || openFor === entry.id) return;
  openFor = entry.id;
  const answers = questions.map(() => "");
  let finished = false;

  openSheet({
    render(panel, close) {
      panel.innerHTML = `
        ${navBar({ title: t("ask.title"), leading: { label: t("app.close") } })}
        <div class="sheet-panel-body ask-body">
          <div class="ask-head">
            ${entry.photoDataUrl ? `<div class="ask-photo"><img src="${safeSrc(entry.photoDataUrl)}" alt="">${sureBadgeHtml(entry)}</div>` : ""}
            <div class="ask-intro">
              <b>${t("ask.notSure", { pct: surePct(entry) ?? "?" })}</b>
              <span>${t("ask.why", { kcal: Math.round(entry.calories || 0) })}</span>
            </div>
          </div>
          ${questions.map((q, qi) => `
            <div class="ask-q" data-q="${qi}">
              <div class="ask-q-text">${esc(q.question)}</div>
              <div class="ask-opts" role="group" aria-label="${esc(q.question)}">
                ${q.options.map((o, oi) => `<button type="button" class="ask-opt" data-q="${qi}" data-o="${oi}" aria-pressed="false">${esc(o)}</button>`).join("")}
              </div>
              <input type="text" class="ask-other" data-q="${qi}" maxlength="80" placeholder="${esc(t("ask.other"))}" aria-label="${esc(t("ask.other"))}">
            </div>`).join("")}
          <button type="button" class="ask-send" id="ask-send" disabled>${t("ask.update")}</button>
          <button type="button" class="ask-skip" id="ask-skip">${t("ask.keep")}</button>
        </div>`;
      wireNavBar(panel, { onLeading: () => close() });
      const send = panel.querySelector("#ask-send");
      const refresh = () => { send.disabled = !answers.some((a) => a.trim() !== ""); };
      panel.querySelectorAll(".ask-opt").forEach((b) => b.addEventListener("click", () => {
        const qi = Number(b.dataset.q);
        const text = questions[qi].options[Number(b.dataset.o)];
        const on = answers[qi] !== text;
        answers[qi] = on ? text : "";
        panel.querySelectorAll(`.ask-opt[data-q="${qi}"]`).forEach((x) => x.setAttribute("aria-pressed", String(on && x === b)));
        panel.querySelector(`.ask-other[data-q="${qi}"]`).value = "";
        refresh();
      }));
      panel.querySelectorAll(".ask-other").forEach((input) => input.addEventListener("input", () => {
        const qi = Number(input.dataset.q);
        answers[qi] = input.value;
        panel.querySelectorAll(`.ask-opt[data-q="${qi}"]`).forEach((x) => x.setAttribute("aria-pressed", "false"));
        refresh();
      }));
      send.addEventListener("click", () => { finished = true; queue.answerQuestions(entry.id, answers); close(); });
      panel.querySelector("#ask-skip").addEventListener("click", () => { finished = true; queue.skipQuestions(entry.id); close(); });
    },
    onClosed() {
      openFor = null;
      onDone?.(finished);
    },
  });
}
