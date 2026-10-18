// action-sheet.js — native iOS confirmationDialog stand-in, used for the failed-entry
// Retry/Edit manually/Delete/Cancel dialog (SPEC-UI.md §5.4.3.B).

/**
 * @param {{title:string, message?:string, actions: Array<{label:string, destructive?:boolean, cancel?:boolean, onSelect?: () => void}>}} opts
 */
export function openActionSheet({ title, message, actions }) {
  const backdrop = document.createElement("div");
  backdrop.className = "action-sheet-backdrop";

  const cancelAction = actions.find((a) => a.cancel);
  const otherActions = actions.filter((a) => !a.cancel);

  const rowHtml = (a, i) =>
    `<button class="action-sheet-btn${a.destructive ? " destructive" : ""}" data-idx="${i}">${a.label}</button>`;

  backdrop.innerHTML = `
    <div class="action-sheet">
      <div class="action-sheet-group">
        <div class="action-sheet-title-block">
          <div class="action-sheet-title">${title}</div>
          ${message ? `<div class="action-sheet-message">${message}</div>` : ""}
        </div>
        ${otherActions.map(rowHtml).join("")}
      </div>
      ${cancelAction ? `<div class="action-sheet-group"><button class="action-sheet-btn action-sheet-cancel" data-idx="cancel">${cancelAction.label}</button></div>` : ""}
    </div>
  `;

  document.body.appendChild(backdrop);

  const close = () => backdrop.remove();

  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) {
      close();
      cancelAction?.onSelect?.(); // tapping outside is the same as Cancel
      return;
    }
    const btn = e.target.closest("[data-idx]");
    if (!btn) return;
    const idx = btn.dataset.idx;
    close();
    if (idx === "cancel") {
      if (cancelAction?.onSelect) cancelAction.onSelect();
      return;
    }
    const action = otherActions[Number(idx)];
    if (action?.onSelect) action.onSelect();
  });

  return { close };
}
