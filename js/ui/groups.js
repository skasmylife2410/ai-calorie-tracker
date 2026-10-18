// groups.js — "Groups" in the Us tab: the groups you're in and who's in them, asks to join that
// are waiting for you, making a group, adding people from your other groups (they join once they
// say yes), inviting someone new (one of your invites, api/invites.js), and leaving a group.
// After any change the Us and Shared tabs are told (snapcal:groups-changed) so they redraw.

import { t } from "../i18n.js";
import { openSheet, navBar, wireNavBar } from "./sheet.js";
import { myGroupsInfo, changeGroups } from "../social.js";
import { apiFetch } from "../net.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const ERRORS = {
  lastGroup: () => t("groups.lastGroup"),
  tooMany: (out) => t("groups.tooMany", { n: out.max ?? 6 }),
  noName: () => t("groups.noName"),
  notMember: () => t("invite.notMember"),
  referrals: () => t("invite.noneLeft", { max: 3 }),
  full: () => t("invite.full"),
  network: () => t("errors.offline"),
};
const errorText = (out) => (ERRORS[out?.errorType] ?? (() => out?.message || t("errors.generic")))(out);

async function invitesCall(body) {
  try {
    const r = await apiFetch("/api/invites", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return await r.json();
  } catch { return { ok: false, errorType: "network" }; }
}

/** Hands an invite link over: the phone's share menu when there is one, else the clipboard. */
async function handLink(code) {
  const url = `${location.origin}/?invite=${code}`;
  if (navigator.share) {
    try { await navigator.share({ text: `${t("invite.shareText")} ${url}` }); return ""; } catch { /* dismissed: copy instead */ }
  }
  try { await navigator.clipboard.writeText(url); } catch { /* old browsers */ }
  return t("invite.copied");
}

/** Tells the Us and Shared tabs the groups changed; `show` switches Us to that group. */
function announce(show = null) {
  globalThis.dispatchEvent?.(new CustomEvent("snapcal:groups-changed", { detail: { show } }));
}

export function openGroupsSheet() {
  openSheet({
    render(panel, close) {
      let info = null;
      let invites = null;     // { left, referrals, isAdmin } from api/invites.js
      let adding = null;      // the group whose "Add people" list is open
      const msgs = {};        // group id (or "new") -> a line under it

      const frame = (body) => {
        panel.innerHTML = `${navBar({ title: t("groups.title"), leading: { label: t("app.close") } })}<div class="sheet-panel-body grp-body">${body}</div>`;
        wireNavBar(panel, { onLeading: close });
      };

      const nameOf = (u) => esc(info.names?.[u] ?? u);

      const draw = () => {
        const groups = info.groups ?? [];
        const everyone = [...new Set(groups.flatMap((g) => g.members))].filter((u) => u !== info.me);
        const left = invites?.isAdmin ? null : invites?.left;
        const pendingHtml = (info.pending ?? []).map((p) => `
          <div class="grp-card grp-ask">
            <b>${t("groups.pendingTitle", { name: nameOf(p.by), group: esc(p.name) })}</b>
            <small>${t("groups.pendingBody")}</small>
            <div class="grp-actions">
              <button type="button" class="acct-btn" data-decline="${esc(p.group)}">${t("groups.decline")}</button>
              <button type="button" class="acct-btn is-primary" data-accept="${esc(p.group)}">${t("groups.join")}</button>
            </div>
          </div>`).join("");
        const groupHtml = (g) => {
          const others = everyone.filter((u) => !g.members.includes(u));
          const asked = new Set((info.sent ?? []).filter((s) => s.group === g.id).map((s) => s.username));
          return `
          <div class="grp-card" data-group-card="${esc(g.id)}">
            <div class="grp-head"><b>${esc(g.name)}</b>
              <button type="button" class="grp-leave" data-leave="${esc(g.id)}" aria-label="${t("groups.leave")} · ${esc(g.name)}">${t("groups.leave")}</button></div>
            <div class="grp-people">${g.members.map((u) => (u === info.me ? `${nameOf(u)} <i>(${t("groups.you")})</i>` : nameOf(u))).join(", ")} <i>· ${t("groups.members", { n: g.members.length })}</i></div>
            <div class="grp-actions">
              <button type="button" class="acct-btn" data-add="${esc(g.id)}" aria-expanded="${adding === g.id}">${t("groups.add")}</button>
              <button type="button" class="acct-btn" data-invite="${esc(g.id)}" ${left === 0 ? "disabled" : ""}>${t("groups.inviteNew")}</button>
            </div>
            ${adding === g.id ? `
              <div class="grp-add">
                <small>${others.length ? t("groups.addLead") : t("groups.nobodyToAdd")}</small>
                ${others.map((u) => `
                  <div class="grp-add-row"><span>${nameOf(u)}</span>
                    ${asked.has(u) ? `<span class="grp-asked">${t("groups.asked")}</span>` : `<button type="button" class="ml-btn" data-ask="${esc(u)}" data-in="${esc(g.id)}">${t("groups.ask")}</button>`}
                  </div>`).join("")}
              </div>` : ""}
            ${msgs[g.id] ? `<div class="acct-msg${msgs[g.id].error ? " is-error" : ""}" role="status">${esc(msgs[g.id].text)}</div>` : ""}
          </div>`;
        };
        frame(`
          ${pendingHtml}
          ${groups.map(groupHtml).join("")}
          <form class="grp-card grp-new" id="grp-new">
            <b>${t("groups.create")}</b>
            <div class="grp-new-row">
              <input type="text" id="grp-name" maxlength="30" placeholder="${t("groups.namePlaceholder")}" autocomplete="off" enterkeyhint="done" aria-label="${t("groups.create")}">
              <button type="submit" class="acct-btn is-primary">${t("groups.createBtn")}</button>
            </div>
            ${msgs.new ? `<div class="acct-msg${msgs.new.error ? " is-error" : ""}" role="status">${esc(msgs.new.text)}</div>` : ""}
          </form>
          <p class="grp-hint">${t("groups.hint")}${left != null ? ` ${left > 0 ? t("groups.invitesLeft", { n: left, max: invites.referrals }) : t("groups.noInvites")}.` : ""}</p>`);
        wire();
      };

      // one change at a time: buttons go quiet until the answer is drawn
      const run = async (key, body, { show = null } = {}) => {
        panel.querySelectorAll("button, input").forEach((b) => { b.disabled = true; });
        const out = await changeGroups(body);
        if (out.ok) { info = out; delete msgs[key]; announce(show ?? out.created ?? null); }
        else msgs[key] = { text: errorText(out), error: true };
        draw();
        return out;
      };

      const wire = () => {
        panel.querySelectorAll("[data-accept]").forEach((b) => b.addEventListener("click", () => run(b.dataset.accept, { op: "accept", group: b.dataset.accept }, { show: b.dataset.accept })));
        panel.querySelectorAll("[data-decline]").forEach((b) => b.addEventListener("click", () => run(b.dataset.decline, { op: "decline", group: b.dataset.decline })));
        panel.querySelectorAll("[data-add]").forEach((b) => b.addEventListener("click", () => { adding = adding === b.dataset.add ? null : b.dataset.add; draw(); }));
        panel.querySelectorAll("[data-ask]").forEach((b) => b.addEventListener("click", () => run(b.dataset.in, { op: "add", group: b.dataset.in, username: b.dataset.ask })));
        panel.querySelectorAll("[data-leave]").forEach((b) => b.addEventListener("click", () => {
          const g = info.groups.find((x) => x.id === b.dataset.leave);
          if (!confirm(t("groups.leaveConfirm", { name: g?.name ?? "" }))) return;
          run(b.dataset.leave, { op: "leave", group: b.dataset.leave });
        }));
        panel.querySelectorAll("[data-invite]").forEach((b) => b.addEventListener("click", async () => {
          const group = b.dataset.invite;
          b.disabled = true;
          const made = await invitesCall({ op: "create", group });
          if (!made.ok) { msgs[group] = { text: errorText(made), error: true }; draw(); return; }
          invites = { ...invites, left: invites?.left != null ? Math.max(0, invites.left - 1) : null };
          const said = await handLink(made.code);
          msgs[group] = { text: said || t("invite.hint"), error: false };
          draw();
        }));
        panel.querySelector("#grp-new")?.addEventListener("submit", async (e) => {
          e.preventDefault();
          const name = panel.querySelector("#grp-name").value.trim();
          if (!name) { msgs.new = { text: t("groups.noName"), error: true }; draw(); return; }
          await run("new", { op: "create", name });
        });
      };

      frame(`<div class="left-working"><span class="left-spin" aria-hidden="true"></span>…</div>`);
      Promise.all([myGroupsInfo({ fresh: true }), invitesCall({ op: "list" })]).then(([out, inv]) => {
        if (!panel.isConnected) return;
        if (!out.ok) { frame(`<p class="left-lead">${esc(errorText(out))}</p>`); return; }
        info = out;
        invites = inv?.ok ? { left: inv.left, referrals: inv.referrals ?? 3, isAdmin: inv.isAdmin } : null;
        draw();
      });
    },
  });
}
