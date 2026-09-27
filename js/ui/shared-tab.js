// shared-tab.js — the Shared tab: your group's posts and shared meals, with comments.
// It used to sit at the bottom of Us; it has its own tab now so the dashboard stays about numbers.
//
// Names, avatars and the group come from /api/compare asked for today only (the smallest answer
// it gives), so the feed shows people exactly as the Us tab does.

import { getStoredToken } from "../net.js";
import { t } from "../i18n.js";
import { renderFeed } from "./us-social.js";
import { localDateString } from "../nutrition.js";
import { COLORS } from "../us.js";

let groupId = null; // which group's feed; null = the server picks your first

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

async function loadPeople() {
  try {
    const res = await fetch("/api/compare", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-snapcal-token": getStoredToken() },
      body: JSON.stringify({ from: localDateString(Date.now()), ...(groupId ? { group: groupId } : {}) }),
    });
    const json = await res.json();
    if (!res.ok || json.errorType) return { error: json.message || t("errors.generic") };
    return json;
  } catch {
    return { error: t("errors.offline") };
  }
}

export async function render(container) {
  container.innerHTML = `
    <div class="us-tab shared-tab">
      <div class="us-tab-head"><h1 class="tg-title">${t("social.tab")}</h1></div>
      <div id="shared-groups"></div>
      <section class="tg-section us-feed" id="shared-feed"><p class="tg-note">…</p></section>
      <div class="bottom-safe-spacer"></div>
    </div>`;
  const data = await loadPeople();
  const feed = container.querySelector("#shared-feed");
  if (!feed) return; // the tab was left while loading
  if (data.error) { feed.innerHTML = `<p class="tg-note">${esc(data.error)}</p>`; return; }

  const groups = data.groups ?? [];
  if (groups.length > 1) {
    const current = data.group?.id ?? groups[0].id;
    const bar = container.querySelector("#shared-groups");
    bar.innerHTML = `<div class="us-groups" role="group" aria-label="${t("groups.switch")}">${groups.map((g) =>
      `<button type="button" data-group="${esc(g.id)}" aria-pressed="${g.id === current}">${esc(g.name)}</button>`).join("")}</div>`;
    bar.querySelectorAll("[data-group]").forEach((b) => b.addEventListener("click", () => {
      if (b.dataset.group === current) return;
      groupId = b.dataset.group;
      render(container);
    }));
  }
  renderFeed(feed, { me: data.me, people: data.people || [], colors: COLORS.map((c) => c.solid), group: data.group?.id ?? null });
}
