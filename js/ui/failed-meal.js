// failed-meal.js — what a tap on a meal whose analysis failed offers: try again, fill it in by
// hand, or remove it. One sheet for every meal list (Home's Today's meals, a day's meals, History).
// A meal saved while the AI was under repair says so, and "Try now" is the same retry.

import * as store from "../store.js";
import * as queue from "../queue.js";
import { t } from "../i18n.js";
import { openActionSheet } from "./action-sheet.js";
import { deleteWithUndo } from "./undo-delete.js";
// opened on a tap, so loaded then
const openAddFoodSheet = (...args) => import("./addfood.js").then((m) => m.openAddFoodSheet(...args));

/** `onChange` redraws the list the meal is in: when the retry starts (it shows as analysing) and when it ends. */
export function openFailedMealSheet(entry, { onChange } = {}) {
  const waiting = queue.isWaitingForAi(entry);
  openActionSheet({
    title: waiting ? t("repair.rowTitle") : t("ui.analysisFailed"),
    message: waiting ? t("repair.rowBody") : entry.analysisFailureReason || t("ui.analysisFailedBody"),
    actions: [
      {
        label: waiting ? t("repair.tryNow") : t("app.retry"),
        onSelect: () => {
          const stop = queue.onComplete((p) => { if (p.entryId === entry.id) { stop(); onChange?.(); } });
          queue.retry(entry.id);
          onChange?.();
        },
      },
      {
        label: t("ui.editManually"),
        onSelect: () => {
          store.updateFoodEntry(entry.id, { analysisFailed: false, analysisWaiting: null });
          openAddFoodSheet({ entry: store.getFoodEntry(entry.id), onSaved: () => onChange?.() });
        },
      },
      { label: t("app.delete"), destructive: true, onSelect: () => deleteWithUndo(entry, onChange) },
      { label: t("app.cancel"), cancel: true },
    ],
  });
}
