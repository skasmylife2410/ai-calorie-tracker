// context-note.js — "Add context": something that explains some days (being sick, travelling, a
// celebration…), so the Friday check-in takes it into account instead of judging those days.
// Notes live on the profile (js/store.js contextNotes) and are read by the server's weekly job
// (api/_week.js weekNotes). Only their owner and the AI coach see them.

import * as store from "../store.js";
import { openSheet, navBar, wireNavBar } from "./sheet.js";
import { icon } from "./icons.js";
import { t, formatDate } from "../i18n.js";
import { localDateString, startOfDay, addDays } from "../nutrition.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const TEXT_MAX = 200;

/** "Sick · Tue – Thu", "Travelling · Mon", "Sick · Mon, Wed" */
export function noteLabel(note) {
  const days = note.days;
  const wd = (d) => formatDate(new Date(`${d}T12:00:00`), { weekday: "short" });
  const consecutive = days.every((d, i) => i === 0 || localDateString(addDays(new Date(`${days[i - 1]}T12:00:00`), 1)) === d);
  const when = days.length === 1 ? wd(days[0])
    : consecutive ? `${wd(days[0])} – ${wd(days[days.length - 1])}`
    : days.map(wd).join(", ");
  return `${t(`ctxNote.kinds.${note.kind}`)} · ${when}`;
}

/** The chip row under Home's week strip: the notes covering the day shown, and "Add context". */
export function contextRowHtml(date) {
  const notes = store.contextNotesForDay(date);
  return `
    <div class="ctx-row" id="ctx-row">
      ${notes.map((n) => `<button type="button" class="ctx-chip is-note" data-ctx-note="${esc(n.id)}">${esc(noteLabel(n))}</button>`).join("")}
      <button type="button" class="ctx-chip" data-ctx-add>${icon("plus", { size: 12 })}<span>${t("ctxNote.add")}</span></button>
    </div>`;
}

/** Wires a row made by contextRowHtml (or any [data-ctx-add] / [data-ctx-note] buttons). */
export function wireContextRow(host, date, onChange) {
  host.querySelectorAll("[data-ctx-add]").forEach((b) => b.addEventListener("click", () => openContextSheet({ day: date, onSaved: onChange })));
  host.querySelectorAll("[data-ctx-note]").forEach((b) => b.addEventListener("click", () => {
    const note = store.contextNotes().find((n) => n.id === b.dataset.ctxNote);
    if (note) openContextSheet({ day: date, note, onSaved: onChange });
  }));
}

/**
 * The sheet: what it was, which days (the week up to the day shown), a line in their own words.
 * @param {{day?: Date|number, note?: object|null, onSaved?: () => void}} opts
 */
export function openContextSheet({ day = Date.now(), note = null, onSaved } = {}) {
  // (startOfDay and addDays work in timestamps)
  const shown = startOfDay(day);
  // seven days ending at the day shown (never past today), so "Tue – Thu" can be picked from Thursday
  const end = Math.min(shown, startOfDay(Date.now()));
  const days = Array.from({ length: 7 }, (_, i) => new Date(addDays(end, i - 6)));
  let kind = note?.kind ?? null;
  const picked = new Set(note?.days ?? [localDateString(shown)]);
  let text = note?.text ?? "";

  openSheet({
    render(panel, close) {
      const draw = () => {
        const ready = Boolean(kind) && picked.size > 0;
        panel.innerHTML = `
          ${navBar({ title: t("ctxNote.title"), leading: { label: t("app.cancel") }, trailing: { label: t("app.save"), bold: true, disabled: !ready } })}
          <div class="sheet-panel-body ctx-body">
            <div class="ctx-q">${t("ctxNote.question")}</div>
            <div class="ctx-sub">${t("ctxNote.why")}</div>
            <div class="ctx-kinds" role="group" aria-label="${t("ctxNote.title")}">
              ${store.CONTEXT_KINDS.map((k) => `<button type="button" class="ctx-chip" data-kind="${k}" aria-pressed="${k === kind}">${t(`ctxNote.kinds.${k}`)}</button>`).join("")}
            </div>
            <div class="ctx-label">${t("ctxNote.whichDays")}</div>
            <div class="ctx-days" role="group" aria-label="${t("ctxNote.whichDays")}">
              ${days.map((d) => {
                const key = localDateString(d);
                return `<button type="button" class="ctx-day" data-day="${key}" aria-pressed="${picked.has(key)}">
                  <span class="ctx-day-wd">${formatDate(d, { weekday: "short" })}</span>
                  <span class="ctx-day-n">${d.getDate()}</span>
                </button>`;
              }).join("")}
            </div>
            <textarea class="ctx-text" id="ctx-text" maxlength="${TEXT_MAX}" rows="3" placeholder="${t("ctxNote.placeholder")}">${esc(text)}</textarea>
            <div class="ctx-private">${t("ctxNote.private")}</div>
            ${note ? `<button type="button" class="ctx-delete" id="ctx-delete">${t("ctxNote.delete")}</button>` : ""}
          </div>`;
        const save = () => {
          if (!kind || picked.size === 0) return;
          store.saveContextNote({ id: note?.id ?? null, kind, days: [...picked], text });
          close();
          onSaved?.();
        };
        wireNavBar(panel, { onLeading: () => close(), onTrailing: save });
        panel.querySelectorAll("[data-kind]").forEach((b) => b.addEventListener("click", () => { kind = b.dataset.kind; draw(); }));
        panel.querySelectorAll("[data-day]").forEach((b) => b.addEventListener("click", () => {
          const key = b.dataset.day;
          if (picked.has(key)) picked.delete(key); else picked.add(key);
          draw();
        }));
        const area = panel.querySelector("#ctx-text");
        area.addEventListener("input", () => { text = area.value; });
        panel.querySelector("#ctx-delete")?.addEventListener("click", () => {
          store.deleteContextNote(note.id);
          close();
          onSaved?.();
        });
      };
      draw();
    },
  });
}
