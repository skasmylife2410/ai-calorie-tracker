// api/_plans.js — planned workouts for a group: once or every week, at a set time, with a split
// (push, pull, legs, or their own). Everyone in the group hears about a new plan; each person
// answers per day ("I'm in" or "can't make it", or for every time) and picks their own split for
// that day; an hour before, the ones who are in get a reminder. Reached through api/groups.js
// (op plan*); the reminder runs from api/weekly.js (?job=tick), which pg_cron calls every five
// minutes because the Hobby plan's own cron only runs daily.
//
// Times are kept as the planner set them: "18:00" in their phone's time zone. Each occurrence is
// worked out from that, so a plan stays at 6pm across daylight-saving changes.
//
// POST { op: "plans" }                                              -> { ok, sessions: [...] }   (next 7 days, all your groups)
// POST { op: "planSave", group, split, custom?, place?, time, tz, day? | weekdays? } -> { ok, id }
// POST { op: "planAnswer", plan, day, going, split?, custom?, every? } -> { ok }
// POST { op: "planEnd", plan }                                      -> { ok }   (whoever planned it)

import { select, insert, patch, remove, newId, restBase, restHeaders } from "./_rest.js";
import { isMember, membersOf, myGroups } from "./_groups.js";
import { notify, displayName } from "./_push.js";

export const SPLITS = ["push", "pull", "legs", "custom"];
const AHEAD_DAYS = 7;
const REMIND_MIN = 60;          // the reminder goes about this long before
const TICK_GAP_MS = 60 * 1000;  // the job runs at most once a minute, however often it's called
const TEXT_MAX = 40;

const fail = (errorType, message) => ({ ok: false, errorType, message });
const clean = (v, n = TEXT_MAX) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const validZone = (tz) => { try { new Intl.DateTimeFormat("en", { timeZone: tz }); return true; } catch { return false; } };

// --- time ---------------------------------------------------------------------------------------

/** The calendar day ("YYYY-MM-DD") it is in `tz` at `ms`. */
export function dayIn(tz, ms = Date.now()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(ms);
}
function offsetMs(tz, ms) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
    .formatToParts(ms).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - Math.floor(ms / 1000) * 1000;
}
/** The moment (ms) a local day and "HH:MM" in `tz` happens. */
export function momentOf(day, time, tz) {
  const [y, m, d] = day.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let at = guess - offsetMs(tz, guess);
  at = guess - offsetMs(tz, at); // once more, for the hour around a daylight-saving change
  return at;
}
const addDay = (day, n) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const weekdayOf = (day) => new Date(`${day}T12:00:00Z`).getUTCDay();

/** A plan's sessions from now (one still going counts for two hours) over the next `days`. */
export function occurrences(plan, now = Date.now(), days = AHEAD_DAYS) {
  const today = dayIn(plan.tz, now);
  const out = [];
  const add = (day) => {
    const at = momentOf(day, plan.time, plan.tz);
    if (at > now - 2 * 3600e3 && at <= now + days * 864e5) out.push({ day, at });
  };
  if (plan.day) add(String(plan.day).slice(0, 10));
  else for (let i = -1; i <= days; i++) { const d = addDay(today, i); if ((plan.weekdays ?? []).includes(weekdayOf(d))) add(d); }
  return out;
}

/** Who's in on a day: their answer for that day, else their "every time" answer. */
export function goingOn(rsvps, planId, day) {
  const mine = new Map();
  for (const r of rsvps) if (r.plan_id === planId && r.day === "*") mine.set(r.username, r);
  for (const r of rsvps) if (r.plan_id === planId && r.day === day) mine.set(r.username, r);
  return [...mine.values()];
}

// --- reading and writing -------------------------------------------------------------------------

async function upsertRsvp(row) {
  const r = await fetch(`${restBase()}/rest/v1/snapcal_plan_rsvps?on_conflict=plan_id,day,username`, {
    method: "POST", headers: restHeaders({ Prefer: "resolution=merge-duplicates,return=minimal" }), body: JSON.stringify([row]),
  });
  if (!r.ok) throw new Error(`Supabase rsvp failed (${r.status})`);
}
const inList = (xs) => `in.(${xs.map((x) => `"${x}"`).join(",")})`;

const LABEL = {
  en: { push: "Push", pull: "Pull", legs: "Legs" },
  es: { push: "Empuje", pull: "Jalón", legs: "Piernas" },
};
export const splitName = (split, custom, lang = "en") => (split === "custom" ? clean(custom) || (lang === "es" ? "Entreno" : "Workout") : LABEL[lang][split] ?? split);
const clock = (at, tz, lang) => new Intl.DateTimeFormat(lang === "es" ? "es-CO" : "en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(at);
const names = (list, lang) => (list.length <= 1 ? list.join("") : `${list.slice(0, -1).join(", ")} ${lang === "es" ? "y" : "and"} ${list.at(-1)}`);

export async function handlePlans(op, me, body) {
  if (op === "plans") {
    const groups = await myGroups(me);
    if (!groups.length) return { ok: true, sessions: [] };
    const plans = await select("snapcal_plans", { select: "*", group_id: inList(groups.map((g) => g.id)), ended_at: "is.null", limit: "100" });
    const rsvps = plans.length ? await select("snapcal_plan_rsvps", { select: "plan_id,day,username,going,split,custom", plan_id: inList(plans.map((p) => p.id)), limit: "2000" }) : [];
    const people = [...new Set([...rsvps.map((r) => r.username), ...plans.map((p) => p.created_by)])];
    const nameOf = Object.fromEntries(await Promise.all(people.map(async (u) => [u, await displayName(u)])));
    const sessions = [];
    for (const p of plans) {
      for (const o of occurrences(p)) {
        const answers = goingOn(rsvps, p.id, o.day);
        const going = answers.filter((r) => r.going).map((r) => ({ username: r.username, name: nameOf[r.username], split: r.split ?? p.split, custom: r.custom ?? p.custom }));
        const myRow = answers.find((r) => r.username === me);
        sessions.push({
          plan: p.id, day: o.day, at: new Date(o.at).toISOString(), tz: p.tz, time: p.time,
          split: p.split, custom: p.custom, place: p.place, group: groups.find((g) => g.id === p.group_id)?.name ?? "",
          weekdays: p.weekdays ?? null, by: p.created_by, byName: nameOf[p.created_by], mine: p.created_by === me,
          going, me: myRow ? { going: myRow.going, split: myRow.split ?? p.split, custom: myRow.custom ?? p.custom, every: myRow.day === "*" } : null,
        });
      }
    }
    sessions.sort((a, b) => a.at.localeCompare(b.at));
    return { ok: true, sessions: sessions.slice(0, 12) };
  }

  if (op === "planSave") {
    const group = String(body.group ?? "");
    const split = SPLITS.includes(body.split) ? body.split : "";
    const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(body.time ?? "")) ? body.time : "";
    const tz = validZone(String(body.tz ?? "")) ? String(body.tz) : "";
    const day = /^\d{4}-\d{2}-\d{2}$/.test(String(body.day ?? "")) ? body.day : null;
    const weekdays = Array.isArray(body.weekdays) ? [...new Set(body.weekdays.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort() : [];
    if (!split || !time || !tz || (!day && !weekdays.length)) return fail("other", "Pick when, the time and the split.");
    if (split === "custom" && !clean(body.custom)) return fail("other", "Name your workout.");
    if (!group || !(await isMember(me, group))) return fail("notMember", "You're not in that group.");
    if (day && momentOf(day, time, tz) < Date.now()) return fail("past", "That time has passed.");
    const id = newId();
    const plan = { id, group_id: group, created_by: me, split, custom: split === "custom" ? clean(body.custom) : null, place: clean(body.place) || null, time, tz, day: day || null, weekdays: day ? null : weekdays };
    await insert("snapcal_plans", plan);
    await upsertRsvp({ plan_id: id, day: "*", username: me, going: true, split, custom: plan.custom, updated_at: new Date().toISOString() });
    // everyone else in the group hears about it once
    const [who, people] = await Promise.all([displayName(me), membersOf(group)]);
    const first = occurrences(plan)[0];
    await notify(people.filter((u) => u !== me), (lang) => {
      const what = splitName(split, plan.custom, lang);
      const when = first ? `${new Intl.DateTimeFormat(lang === "es" ? "es-CO" : "en-US", { timeZone: tz, weekday: "long" }).format(first.at)} ${clock(first.at, tz, lang)}` : time;
      return {
        title: lang === "es" ? `${who} planeó: ${what}` : `${who} planned ${what}`,
        body: (lang === "es" ? `${day ? "" : "Cada semana · "}${when}${plan.place ? ` · ${plan.place}` : ""}. ¿Te apuntas?` : `${day ? "" : "Every week · "}${when}${plan.place ? ` · ${plan.place}` : ""}. Are you in?`),
        url: "/?tab=us", tag: `plan-${id}`,
      };
    });
    return { ok: true, id };
  }

  if (op === "planAnswer" || op === "planEnd") {
    const [p] = await select("snapcal_plans", { select: "*", id: `eq.${String(body.plan ?? "")}`, limit: "1" });
    if (!p || p.ended_at || !(await isMember(me, p.group_id))) return fail("other", "That plan isn't there any more.");
    if (op === "planEnd") {
      if (p.created_by !== me) return fail("forbidden", "Only whoever planned it can remove it.");
      await patch("snapcal_plans", { id: `eq.${p.id}` }, { ended_at: new Date().toISOString() });
      return { ok: true };
    }
    const day = body.every === true ? "*" : String(body.day ?? "");
    if (day !== "*" && !occurrences(p).some((o) => o.day === day)) return fail("other", "That day isn't planned.");
    const split = SPLITS.includes(body.split) ? body.split : p.split;
    await upsertRsvp({ plan_id: p.id, day, username: me, going: body.going !== false, split, custom: split === "custom" ? clean(body.custom) || null : null, updated_at: new Date().toISOString() });
    // "every time" replaces the single-day answers they gave before
    if (day === "*") await remove("snapcal_plan_rsvps", { plan_id: `eq.${p.id}`, username: `eq.${me}`, day: "neq.*" });
    return { ok: true };
  }
  return null;
}

// --- the reminder ---------------------------------------------------------------------------------

/** Takes the "tick" lock: true when this call should run (nobody ran it in the last minute). */
async function takeTick(name, now) {
  const [row] = await select("snapcal_ticks", { select: "at", name: `eq.${name}`, limit: "1" });
  if (row && Date.parse(row.at) > now - TICK_GAP_MS) return false;
  const r = await fetch(`${restBase()}/rest/v1/snapcal_ticks?on_conflict=name`, {
    method: "POST", headers: restHeaders({ Prefer: "resolution=merge-duplicates,return=minimal" }), body: JSON.stringify([{ name, at: new Date(now).toISOString() }]),
  });
  return r.ok;
}

/** An hour before each session, the people who are in hear about it (once). */
export async function planReminders(now = Date.now()) {
  if (!(await takeTick("plans", now))) return { skipped: true };
  const plans = await select("snapcal_plans", { select: "*", ended_at: "is.null", limit: "500" });
  const due = [];
  for (const p of plans) for (const o of occurrences(p, now, 1)) {
    const mins = (o.at - now) / 60000;
    if (mins > 0 && mins <= REMIND_MIN + 5) due.push({ p, o });
  }
  if (!due.length) return { sent: 0 };
  const sentRows = await select("snapcal_plan_sent", { select: "plan_id,day", plan_id: inList([...new Set(due.map((d) => d.p.id))]), kind: "eq.hour", limit: "1000" });
  const rsvps = await select("snapcal_plan_rsvps", { select: "plan_id,day,username,going,split,custom", plan_id: inList([...new Set(due.map((d) => d.p.id))]), limit: "2000" });
  let sent = 0;
  for (const { p, o } of due) {
    if (sentRows.some((r) => r.plan_id === p.id && r.day === o.day)) continue;
    // claim it first, so two runs can't both send it
    try { await insert("snapcal_plan_sent", { plan_id: p.id, day: o.day, kind: "hour" }); } catch { continue; }
    const going = goingOn(rsvps, p.id, o.day).filter((r) => r.going);
    if (!going.length) continue;
    const nameOf = Object.fromEntries(await Promise.all(going.map(async (r) => [r.username, await displayName(r.username)])));
    for (const r of going) {
      const others = going.filter((x) => x.username !== r.username).map((x) => nameOf[x.username]);
      const out = await notify([r.username], (lang) => ({
        title: lang === "es"
          ? `${splitName(r.split ?? p.split, r.custom ?? p.custom, lang)} a las ${clock(o.at, p.tz, lang)}`
          : `${splitName(r.split ?? p.split, r.custom ?? p.custom, lang)} day at ${clock(o.at, p.tz, lang)}`,
        body: [lang === "es" ? "En una hora" : "In about an hour", p.place, others.length ? (lang === "es" ? `${names(others, lang)} ${others.length > 1 ? "van" : "va"}` : `${names(others, lang)} ${others.length > 1 ? "are" : "is"} going`) : null].filter(Boolean).join(" · "),
        url: "/?tab=us", tag: `plan-${p.id}-${o.day}`,
      }));
      sent += out.sent ?? 0;
    }
  }
  return { sent, due: due.length };
}
