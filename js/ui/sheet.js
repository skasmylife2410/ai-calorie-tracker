// sheet.js — shared modal shell: `.sheet` (slide up from bottom, dimmed backdrop, swipe-down to
// dismiss) and `.fullScreenCover` (opaque, covers everything, slides up from bottom, no dim).
// Mirrors SwiftUI's default sheet/full-screen-cover transitions (SPEC-UI.md §15 footer note).

function modalRoot() {
  let root = document.getElementById("modal-root");
  if (!root) {
    root = document.createElement("div");
    root.id = "modal-root";
    document.body.appendChild(root);
  }
  return root;
}

const TRANSITION_MS = 320;

/**
 * Opens a sheet (dimmed backdrop + slide-up panel). `render(bodyEl, close)` builds the panel's
 * content (the screen module owns its own navbar markup inside bodyEl).
 * @returns {{close: () => void, panelEl: HTMLElement}}
 */
export function openSheet({ render, onClosed }) {
  const root = modalRoot();

  const backdrop = document.createElement("div");
  backdrop.className = "sheet-backdrop";
  const panel = document.createElement("div");
  panel.className = "sheet-panel";
  panel.setAttribute("role", "dialog");

  root.appendChild(backdrop);
  root.appendChild(panel);

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    backdrop.classList.remove("visible");
    panel.classList.remove("visible");
    setTimeout(() => {
      backdrop.remove();
      panel.remove();
      if (typeof onClosed === "function") onClosed();
    }, TRANSITION_MS);
  };

  backdrop.addEventListener("click", close);

  // Swipe-down-to-dismiss on the panel itself (drag starting near the top acts like the grip).
  wireDragToDismiss(panel, close);

  render(panel, close);

  requestAnimationFrame(() => {
    backdrop.classList.add("visible");
    panel.classList.add("visible");
  });

  return { close, panelEl: panel };
}

/**
 * Opens a full-screen cover (opaque, no dim backdrop) — used for CameraScanView.
 * @returns {{close: () => void, panelEl: HTMLElement}}
 */
export function openFullScreenCover({ render, onClosed }) {
  const root = modalRoot();
  const panel = document.createElement("div");
  panel.className = "fullscreen-cover";
  root.appendChild(panel);

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    panel.classList.remove("visible");
    setTimeout(() => {
      panel.remove();
      if (typeof onClosed === "function") onClosed();
    }, TRANSITION_MS);
  };

  render(panel, close);

  requestAnimationFrame(() => panel.classList.add("visible"));

  return { close, panelEl: panel };
}

function wireDragToDismiss(panel, close) {
  let startY = null;
  let dragging = false;

  panel.addEventListener(
    "touchstart",
    (e) => {
      const scrollable = e.target.closest(".sheet-panel-body");
      if (scrollable && scrollable.scrollTop > 0) return;
      if (e.target.closest("[data-no-sheet-drag]")) return; // e.g. a photo being cropped
      startY = e.touches[0].clientY;
      dragging = true;
      panel.style.transition = "none";
    },
    { passive: true }
  );

  panel.addEventListener(
    "touchmove",
    (e) => {
      if (!dragging || startY === null) return;
      const dy = e.touches[0].clientY - startY;
      if (dy > 0) panel.style.transform = `translateY(${dy}px)`;
    },
    { passive: true }
  );

  panel.addEventListener("touchend", (e) => {
    if (!dragging) return;
    dragging = false;
    panel.style.transition = "";
    const dy = (e.changedTouches[0]?.clientY ?? startY) - (startY ?? 0);
    panel.style.transform = "";
    if (dy > 120) {
      close();
    }
    startY = null;
  });
}

/** Builds a standard iOS-style nav bar. `leading`/`trailing` are {label, onClick, disabled?, destructive?, bold?}. */
export function navBar({ title, leading, trailing }) {
  const btn = (spec, extraClass) =>
    spec
      ? `<button class="navbar-btn ${extraClass}${spec.bold ? " bold" : ""}${spec.destructive ? " destructive" : ""}" ${spec.disabled ? "disabled" : ""} data-nav="${extraClass}">${spec.label}</button>`
      : `<span class="navbar-spacer"></span>`;
  return `
    <div class="navbar">
      ${btn(leading, "leading")}
      <div class="navbar-title">${title}</div>
      ${btn(trailing, "trailing")}
    </div>
  `;
}

/** Wires the leading/trailing nav bar buttons rendered by navBar() above. */
export function wireNavBar(container, { onLeading, onTrailing } = {}) {
  const leading = container.querySelector('[data-nav="leading"]');
  const trailing = container.querySelector('[data-nav="trailing"]');
  if (leading && onLeading) leading.addEventListener("click", onLeading);
  if (trailing && onTrailing) trailing.addEventListener("click", onTrailing);
}
