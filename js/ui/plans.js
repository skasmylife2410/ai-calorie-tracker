// plans.js — planned workouts in Train together (Us): what's coming up in your groups, planning a
// session (once or every week, a time, a split: push, pull, legs or your own, and where), and each
// session's sheet, where you say you're in and pick your own split for that day. The server side
// and the hour-before reminder are api/_plans.js. Figma "Boca0 · Workout plans".

import { t, currentLanguage } from "../i18n.js";
import { apiFetch } from "../net.js";
import { openSheet, navBar, wireNavBar } from "./sheet.js";
import { myGroupsInfo } from "../social.js";

export const SPLITS = ["push", "pull", "legs", "custom"];
const CACHE_MS = 60 * 1000;
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

async function api(body) {
  try {
    const res = await apiFetch("/api/groups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return await res.json();
  } catch {
    return { ok: false, errorType: "network" };
  }
}

let cache = { at: 0, out: null };
export async function loadPlans({ fresh = false } = {}) {
  if (!fresh && cache.out && Date.now() - cache.at < CACHE_MS) return cache.out;
  const out = await api({ op: "plans" });
  if (out.ok) cache = { at: Date.now(), out };
  return out;
}
const changed = () => { cache = { at: 0, out: null }; globalThis.dispatchEvent?.(new CustomEvent("boca0:plans-changed")); };

// --- words and times -----------------------------------------------------------------------------

export function splitLabel(split, custom) {
  return split === "custom" ? (String(custom ?? "").trim() || t("plans.splits.custom")) : t(`plans.splits.${split}`);
}
const locale = () => (currentLanguage() === "es" ? "es-CO" : "en-US");

/** "6:00" and "PM" (or "18:00" and "" where the language uses 24 hours), in this phone's time. */
export function clockParts(at, loc = locale()) {
  const parts = new Intl.DateTimeFormat(loc, { hour: "numeric", minute: "2-digit" }).formatToParts(new Date(at));
  const time = parts.filter((p) => p.type !== "dayPeriod").map((p) => p.value).join("").trim();
  const period = parts.find((p) => p.type === "dayPeriod")?.value.replace(/\./g, "").trim().toUpperCase() ?? "";
  return { time, period };
}

/** "Today", "Tomorrow" or "Thu 20". */
export function dayLabel(at, now = Date.now(), loc = locale()) {
  const d = new Date(at);
  const key = (x) => new Date(x).toDateString();
  if (key(d) === key(now)) return t("plans.today");
  if (key(d) === key(now + 864e5)) return t("plans.tomorrow");
  return new Intl.DateTimeFormat(loc, { weekday: "short", day: "numeric" }).format(d);
}

/** "every Mon, Wed, Fri" in this language. */
export function everyLabel(weekdays, loc = locale()) {
  if (!weekdays?.length) return "";
  const base = Date.UTC(2026, 10, 15, 12); // a Sunday
  const days = weekdays.map((w) => new Intl.DateTimeFormat(loc, { weekday: "short", timeZone: "UTC" }).format(base + w * 864e5));
  return t("plans.every", { days: days.join(", ") });
}

// --- the list on Us ------------------------------------------------------------------------------

export function plansHtml(out) {
  const sessions = out?.ok ? out.sessions : [];
  return `
    <div class="pl">
      ${sessions.length ? `<div class="pl-label">${t("plans.planned")}</div>` : ""}
      ${sessions.slice(0, 4).map((s, i) => {
        const c = clockParts(s.at);
        const going = s.going.length;
        const sub = [s.place, going ? t("plans.going", { n: going }) : null].filter(Boolean).join(" · ");
        return `
          <div class="pl-row" role="button" tabindex="0" data-pl="${i}">
            <div class="pl-when">
              <span class="pl-day">${esc(dayLabel(s.at))}${s.weekdays ? ` · ${esc(everyLabel(s.weekdays))}` : ""}</span>
              <span class="pl-clock"><b>${esc(c.time)}</b>${c.period ? `<small>${esc(c.period)}</small>` : ""}</span>
            </div>
            <div class="pl-what"><b>${esc(splitLabel(s.split, s.custom))}</b><span>${esc(sub)}</span></div>
            ${s.me?.going
              ? `<button type="button" class="pl-btn is-on" data-pl-open="${i}">${t("plans.goingBtn")}</button>`
              : `<button type="button" class="pl-btn" data-pl-in="${i}">${t("plans.imIn")}</button>`}
          </div>`;
      }).join("")}
      <button type="button" class="pl-new" data-pl-new>+ ${t("plans.plan")}</button>
    </div>`;
}

export function wirePlans(root, out, { group } = {}) {
  const sessions = out?.ok ? out.sessions : [];
  root.querySelectorAll("[data-pl]").forEach((row) => {
    const open = () => openSession(sessions[Number(row.dataset.pl)]);
    row.addEventListener("click", (e) => { if (!e.target.closest("[data-pl-in]")) open(); });
    row.addEventListener("keydown", (e) => { if (e.key === "Enter") open(); });
  });
  root.querySelectorAll("[data-pl-in]").forEach((b) => b.addEventListener("click", async () => {
    const s = sessions[Number(b.dataset.plIn)];
    b.disabled = true;
    const res = await api({ op: "planAnswer", plan: s.plan, day: s.day, going: true, split: s.split, custom: s.custom });
    if (!res.ok) { b.disabled = false; alert(res.message || t("errors.generic")); return; }
    changed();
  }));
  root.querySelector("[data-pl-new]")?.addEventListener("click", () => openPlanSheet({ group }));
}

// --- planning a session --------------------------------------------------------------------------

const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function openPlanSheet({ group } = {}) {
  const st = { every: true, weekdays: [new Date().getDay()], day: localDay(), time: "18:00", split: "push", custom: "", place: "", group: group?.id ?? null, busy: false, error: "" };
  let groups = [];
  myGroupsInfo().then((g) => { groups = g?.groups ?? []; if (!st.group) st.group = groups[0]?.id ?? null; draw?.(); }).catch(() => {});
  let draw = null;
  const base = Date.UTC(2026, 10, 16, 12); // a Monday: the week starts on Monday here
  const weekOrder = [1, 2, 3, 4, 5, 6, 0];
  openSheet({
    render: (panel, close) => {
      draw = () => {
        const ok = st.split && st.time && (st.every ? st.weekdays.length : st.day) && (st.split !== "custom" || st.custom.trim()) && st.group;
        const groupName = groups.find((g) => g.id === st.group)?.name ?? group?.name ?? "";
        panel.innerHTML = `
          ${navBar({ title: t("plans.plan"), leading: { label: t("app.cancel") }, trailing: { label: st.busy ? "…" : t("app.save"), bold: true, disabled: !ok || st.busy } })}
          <div class="sheet-panel-body pl-sheet">
            <div class="pl-f">${t("plans.howOften")}</div>
            <div class="pl-seg" role="group">
              <button type="button" data-every="1" aria-pressed="${st.every}">${t("plans.everyWeek")}</button>
              <button type="button" data-every="0" aria-pressed="${!st.every}">${t("plans.once")}</button>
            </div>
            ${st.every ? `
              <div class="pl-days" role="group" aria-label="${t("plans.howOften")}">
                ${weekOrder.map((w) => `<button type="button" data-wd="${w}" aria-pressed="${st.weekdays.includes(w)}">${esc(new Intl.DateTimeFormat(locale(), { weekday: "narrow", timeZone: "UTC" }).format(base + ((w + 6) % 7) * 864e5))}</button>`).join("")}
              </div>` : `
              <input type="date" class="pl-input" id="pl-day" value="${st.day}" min="${localDay()}" />`}
            <div class="pl-f">${t("plans.time")}</div>
            <input type="time" class="pl-time" id="pl-time" value="${st.time}" />
            <div class="pl-f">${t("plans.split")}</div>
            <div class="ctx-kinds" role="group">
              ${SPLITS.map((s) => `<button type="button" class="ctx-chip" data-split="${s}" aria-pressed="${st.split === s}">${t(`plans.splits.${s}`)}</button>`).join("")}
            </div>
            ${st.split === "custom"
              ? `<input class="pl-input" id="pl-custom" maxlength="40" placeholder="${t("plans.customPh")}" value="${esc(st.custom)}" />`
              : `<p class="pl-hint">${t(`plans.hints.${st.split}`)}</p>`}
            <div class="pl-f">${t("plans.where")}</div>
            <input class="pl-input" id="pl-place" maxlength="40" placeholder="${t("plans.wherePh")}" value="${esc(st.place)}" />
            ${groups.length > 1 ? `
              <div class="pl-f">${t("plans.for")}</div>
              <div class="ctx-kinds" role="group">
                ${groups.map((g) => `<button type="button" class="ctx-chip" data-group="${esc(g.id)}" aria-pressed="${g.id === st.group}">${esc(g.name)}</button>`).join("")}
              </div>` : ""}
            <p class="pl-hint">${t("plans.who", { group: esc(groupName) })}</p>
            ${st.error ? `<p class="pl-error">${esc(st.error)}</p>` : ""}
          </div>`;
        wireNavBar(panel, { onLeading: close, onTrailing: save });
        panel.querySelectorAll("[data-every]").forEach((b) => b.addEventListener("click", () => { st.every = b.dataset.every === "1"; draw(); }));
        panel.querySelectorAll("[data-wd]").forEach((b) => b.addEventListener("click", () => {
          const w = Number(b.dataset.wd);
          st.weekdays = st.weekdays.includes(w) ? st.weekdays.filter((x) => x !== w) : [...st.weekdays, w];
          draw();
        }));
        panel.querySelectorAll("[data-split]").forEach((b) => b.addEventListener("click", () => { st.split = b.dataset.split; draw(); }));
        panel.querySelectorAll("[data-group]").forEach((b) => b.addEventListener("click", () => { st.group = b.dataset.group; draw(); }));
        const bind = (id, key, redraw = false) => panel.querySelector(`#${id}`)?.addEventListener(redraw ? "change" : "input", (e) => {
          st[key] = e.target.value;
          const save = panel.querySelector('[data-nav="trailing"]');
          if (save) save.disabled = !(st.split && st.time && (st.every ? st.weekdays.length : st.day) && (st.split !== "custom" || st.custom.trim()) && st.group);
          if (redraw) draw();
        });
        bind("pl-day", "day", true); bind("pl-time", "time"); bind("pl-custom", "custom"); bind("pl-place", "place");
      };
      const save = async () => {
        if (st.busy) return;
        st.busy = true; st.error = ""; draw();
        const out = await api({
          op: "planSave", group: st.group, split: st.split, custom: st.custom, place: st.place, time: st.time,
          tz: Intl.DateTimeFormat().resolvedOptions().timeZone, ...(st.every ? { weekdays: st.weekdays } : { day: st.day }),
        });
        st.busy = false;
        if (!out.ok) { st.error = out.errorType === "past" ? t("plans.past") : out.message || t("errors.generic"); draw(); return; }
        changed();
        close();
      };
      draw();
    },
  });
}

// --- one session ---------------------------------------------------------------------------------

export function openSession(s) {
  if (!s) return;
  const st = { split: s.me?.split ?? s.split, custom: s.me?.custom ?? s.custom ?? "", every: Boolean(s.weekdays) && (s.me?.every ?? false), busy: false };
  openSheet({
    render: (panel, close) => {
      const draw = () => {
        const c = clockParts(s.at);
        panel.innerHTML = `
          <div class="pl-session">
            <div class="pl-day">${esc(dayLabel(s.at))}${s.weekdays ? ` · ${esc(everyLabel(s.weekdays))}` : ""}</div>
            <div class="pl-clock is-big"><b>${esc(c.time)}</b>${c.period ? `<small>${esc(c.period)}</small>` : ""}</div>
            <div class="pl-title">${esc(splitLabel(s.split, s.custom))}${s.place ? ` · ${esc(s.place)}` : ""}</div>
            <div class="pl-by">${t("plans.by", { name: esc(s.byName), group: esc(s.group) })}</div>
            <div class="pl-f">${t("plans.yourSplit")}</div>
            <div class="ctx-kinds" role="group">
              ${SPLITS.map((x) => `<button type="button" class="ctx-chip" data-split="${x}" aria-pressed="${st.split === x}">${t(`plans.splits.${x}`)}</button>`).join("")}
            </div>
            ${st.split === "custom" ? `<input class="pl-input" id="pl-custom" maxlength="40" placeholder="${t("plans.customPh")}" value="${esc(st.custom)}" />` : ""}
            ${s.weekdays ? `<label class="pl-every"><input type="checkbox" id="pl-every" ${st.every ? "checked" : ""} /> <span>${t("plans.everyTime", { days: esc(everyLabel(s.weekdays)) })}</span></label>` : ""}
            <div class="pl-f">${t("plans.goingN", { n: s.going.length })}</div>
            <ul class="pl-who">
              ${s.going.map((g) => `<li><b>${esc(g.name)}</b><span>${esc(splitLabel(g.split, g.custom))}</span></li>`).join("") || `<li class="pl-nobody">${t("plans.nobodyYet")}</li>`}
            </ul>
            <div class="pl-actions">
              <button type="button" class="acct-btn is-primary" data-go="1" ${st.busy ? "disabled" : ""}>${s.me?.going ? t("plans.update") : t("plans.imIn")}</button>
              <button type="button" class="pl-plain" data-go="0" ${st.busy ? "disabled" : ""}>${t("plans.cant")}</button>
              ${s.mine ? `<button type="button" class="pl-remove" data-end>${t("plans.remove")}</button>` : ""}
            </div>
          </div>`;
        panel.querySelectorAll("[data-split]").forEach((b) => b.addEventListener("click", () => { st.split = b.dataset.split; draw(); }));
        panel.querySelector("#pl-custom")?.addEventListener("input", (e) => { st.custom = e.target.value; });
        panel.querySelector("#pl-every")?.addEventListener("change", (e) => { st.every = e.target.checked; });
        panel.querySelectorAll("[data-go]").forEach((b) => b.addEventListener("click", async () => {
          st.busy = true; draw();
          const out = await api({ op: "planAnswer", plan: s.plan, day: s.day, every: st.every, going: b.dataset.go === "1", split: st.split, custom: st.custom });
          st.busy = false;
          if (!out.ok) { alert(out.message || t("errors.generic")); draw(); return; }
          changed(); close();
        }));
        panel.querySelector("[data-end]")?.addEventListener("click", async () => {
          if (!confirm(t("plans.removeAsk"))) return;
          const out = await api({ op: "planEnd", plan: s.plan });
          if (!out.ok) { alert(out.message || t("errors.generic")); return; }
          changed(); close();
        });
      };
      draw();
    },
  });
}
