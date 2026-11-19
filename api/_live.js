// api/_live.js — "Train together": go live for one of your groups while you work out; the others
// swipe through whoever is live, like a feed of streams. Reached through api/groups.js (op live*),
// because the Hobby plan has no room for another endpoint.
//
// The video never touches this server. Phones connect straight to each other (WebRTC): a viewer
// posts a connection offer, the person who's live picks it up on their next beat and posts an
// answer, and from then on the phones talk directly. Only who is live, what they're training and
// these two short texts are stored; nothing is recorded.
//
// POST { op: "live", group? }                        -> { ok, sessions, ice, mine }  (no group: all of yours)
// POST { op: "liveLevel" }                          -> { ok, level, trainingDays, perWeek, weeks }  (from their exercise log)
// POST { op: "liveStart", group, muscle }           -> { ok, id, level }   (tells the group, once in a while)
// POST { op: "liveBeat", id }                        -> { ok, offers: [{ id, viewer, name, offer }], left, watching }
// POST { op: "liveAnswer", signal, answer }          -> { ok }
// POST { op: "liveEnd", id }                         -> { ok }
// POST { op: "liveJoin", id, offer }                 -> { ok, signal }
// POST { op: "liveWait", signal }                    -> { ok, answer, ended }
// POST { op: "liveLeave", signal }                   -> { ok }

import { select, insert, patch, remove, newId } from "./_rest.js";
import { isMember, membersOf, myGroups } from "./_groups.js";
import { notify, displayName } from "./_push.js";

export const MUSCLES = ["chest", "back", "legs", "shoulders", "arms", "core", "full", "cardio"];
export const LEVELS = ["beginner", "average", "expert"];
export const MAX_WATCHING = 10;    // every viewer is a separate upload from the phone that's live
const ALIVE_MS = 30 * 1000;        // a session or viewer with no beat for this long is gone
const NOTIFY_EVERY_MS = 2 * 3600 * 1000; // the group hears "X is live" at most this often per person
const SDP_MAX = 20000;

// --- level, from what they've logged ---------------------------------------------------------
// Nobody picks their own level: it comes from their exercise log over the last eight weeks.
// A training day is a day with at least one session of 20+ minutes that isn't an easy walk.
const LEVEL_WINDOW_DAYS = 56;
const MIN_SESSION_MIN = 20;

/** "beginner" | "average" | "expert" from exercise rows ({ day, data }), plus the numbers behind it. */
export function levelFromLog(rows, { today = new Date().toISOString().slice(0, 10), firstDay = null } = {}) {
  const from = new Date(Date.parse(`${today}T00:00:00Z`) - (LEVEL_WINDOW_DAYS - 1) * 864e5).toISOString().slice(0, 10);
  const days = new Set();
  for (const r of rows ?? []) {
    const d = r?.data ?? {};
    if (d.deleted || !r.day || r.day < from || r.day > today) continue;
    if ((Number(d.minutes) || 0) < MIN_SESSION_MIN) continue;
    if (d.activity === "walk" && d.intensity !== "hard") continue;
    days.add(r.day);
  }
  const perWeek = days.size / (LEVEL_WINDOW_DAYS / 7);
  // expert needs it to be a habit: training logged for six weeks or more
  const weeksLogging = firstDay ? (Date.parse(today) - Date.parse(firstDay)) / (7 * 864e5) : 0;
  const level = perWeek >= 3.5 && weeksLogging >= 6 ? "expert" : perWeek >= 1.5 ? "average" : "beginner";
  return { level, trainingDays: days.size, perWeek: Math.round(perWeek * 10) / 10, weeks: LEVEL_WINDOW_DAYS / 7 };
}

async function levelOf(username) {
  const from = new Date(Date.now() - LEVEL_WINDOW_DAYS * 864e5).toISOString().slice(0, 10);
  const [rows, first] = await Promise.all([
    select("snapcal_exercise", { select: "day,data", owner: `eq.${username}`, day: `gte.${from}`, limit: "1000" }),
    select("snapcal_exercise", { select: "day", owner: `eq.${username}`, order: "day.asc", limit: "1" }),
  ]);
  return levelFromLog(rows, { firstDay: first[0]?.day ?? null });
}

const fail = (errorType, message) => ({ ok: false, errorType, message });
const since = (ms) => new Date(Date.now() - ms).toISOString();
const cleanSdp = (v) => {
  const s = String(v ?? "");
  return s.startsWith("v=0") && s.length <= SDP_MAX ? s : "";
};

/** STUN for everyone; a TURN relay too when one is configured (phones behind strict mobile networks). */
export function iceServers(env = process.env) {
  const out = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }];
  const urls = String(env.LIVE_TURN_URLS ?? "").split(",").map((u) => u.trim()).filter(Boolean);
  if (urls.length && env.LIVE_TURN_USERNAME && env.LIVE_TURN_CREDENTIAL) {
    out.push({ urls, username: env.LIVE_TURN_USERNAME, credential: env.LIVE_TURN_CREDENTIAL });
  }
  return out;
}

async function session(id) {
  const [s] = await select("snapcal_live", { select: "*", id: `eq.${id}`, limit: "1" });
  return s ?? null;
}
const isAlive = (s) => s && !s.ended_at && Date.parse(s.last_seen) > Date.now() - ALIVE_MS;

async function watchingCount(liveId) {
  const rows = await select("snapcal_live_signals", { select: "id", live_id: `eq.${liveId}`, left_at: "is.null", answer: "not.is.null", last_seen: `gt.${since(ALIVE_MS)}`, limit: "50" });
  return rows.length;
}

export async function handleLive(op, me, body) {
  if (op === "live") {
    // one group, or (no group) every group you're in: the feed you swipe through
    const group = String(body.group ?? "");
    const mine = await myGroups(me);
    const ids = group ? mine.filter((g) => g.id === group).map((g) => g.id) : mine.map((g) => g.id);
    if (!ids.length) return fail("notMember", "You're not in that group.");
    const rows = await select("snapcal_live", { select: "id,owner,group_id,muscle,level,started_at", group_id: `in.(${ids.map((g) => `"${g}"`).join(",")})`, ended_at: "is.null", last_seen: `gt.${since(ALIVE_MS)}`, order: "started_at.desc", limit: "30" });
    const sessions = await Promise.all(rows.map(async (r) => ({
      id: r.id, owner: r.owner, name: await displayName(r.owner), muscle: r.muscle, level: r.level,
      group: mine.find((g) => g.id === r.group_id)?.name ?? "", startedAt: r.started_at, watching: await watchingCount(r.id),
    })));
    return { ok: true, sessions, ice: iceServers(), mine: sessions.find((s) => s.owner === me)?.id ?? null };
  }

  if (op === "liveLevel") return { ok: true, ...(await levelOf(me)) };

  if (op === "liveStart") {
    const group = String(body.group ?? "");
    const muscle = MUSCLES.includes(body.muscle) ? body.muscle : "";
    if (!muscle) return fail("other", "Pick what you're training.");
    const { level } = await levelOf(me); // from their log, never from the phone
    if (!group || !(await isMember(me, group))) return fail("notMember", "You're not in that group.");
    // one session at a time: an older one of yours ends, and day-old leftovers are cleared
    await patch("snapcal_live", { owner: `eq.${me}`, ended_at: "is.null" }, { ended_at: new Date().toISOString() });
    await remove("snapcal_live", { started_at: `lt.${since(24 * 3600 * 1000)}` }).catch(() => {});
    const recent = await select("snapcal_live", { select: "id", owner: `eq.${me}`, started_at: `gt.${since(NOTIFY_EVERY_MS)}`, limit: "1" });
    const id = newId();
    await insert("snapcal_live", { id, owner: me, group_id: group, muscle, level });
    if (recent.length === 0) {
      const [who, people] = await Promise.all([displayName(me), membersOf(group)]);
      const word = (lang) => LABELS[lang][muscle];
      await notify(people.filter((u) => u !== me), (lang) => ({
        title: lang === "es" ? `${who} está en vivo: ${word("es")}` : `${who} is live: ${word("en")}`,
        body: lang === "es" ? "Toca para mirar." : "Tap to watch.",
        url: `/?tab=us&live=${id}`,
        tag: `live-${me}`,
      }));
    }
    return { ok: true, id, level };
  }

  if (op === "liveBeat" || op === "liveEnd") {
    const s = await session(String(body.id ?? ""));
    if (!s || s.owner !== me) return fail("other", "No such session.");
    if (op === "liveEnd") {
      await patch("snapcal_live", { id: `eq.${s.id}` }, { ended_at: new Date().toISOString() });
      return { ok: true };
    }
    if (s.ended_at) return { ok: true, ended: true, offers: [], watching: 0 };
    await patch("snapcal_live", { id: `eq.${s.id}` }, { last_seen: new Date().toISOString() });
    const waiting = await select("snapcal_live_signals", { select: "id,viewer,offer", live_id: `eq.${s.id}`, answer: "is.null", left_at: "is.null", created_at: `gt.${since(ALIVE_MS)}`, limit: "10" });
    const offers = await Promise.all(waiting.map(async (w) => ({ ...w, name: await displayName(w.viewer) })));
    const left = await select("snapcal_live_signals", { select: "id", live_id: `eq.${s.id}`, or: `(left_at.not.is.null,last_seen.lt.${since(ALIVE_MS)})`, limit: "50" });
    return { ok: true, offers, left: left.map((r) => r.id), watching: await watchingCount(s.id) };
  }

  if (op === "liveAnswer") {
    const answer = cleanSdp(body.answer);
    const [sig] = await select("snapcal_live_signals", { select: "id,live_id", id: `eq.${String(body.signal ?? "")}`, limit: "1" });
    const s = sig ? await session(sig.live_id) : null;
    if (!s || s.owner !== me || !answer) return fail("other", "No such viewer.");
    await patch("snapcal_live_signals", { id: `eq.${sig.id}` }, { answer, last_seen: new Date().toISOString() });
    return { ok: true };
  }

  if (op === "liveJoin") {
    const offer = cleanSdp(body.offer);
    const s = await session(String(body.id ?? ""));
    if (!isAlive(s)) return fail("ended", "They're not live any more.");
    if (s.owner === me) return fail("other", "That's you.");
    if (!(await isMember(me, s.group_id))) return fail("notMember", "You're not in that group.");
    if (!offer) return fail("other", "Couldn't start the video.");
    // a phone that reconnects replaces its earlier seat
    await patch("snapcal_live_signals", { live_id: `eq.${s.id}`, viewer: `eq.${me}`, left_at: "is.null" }, { left_at: new Date().toISOString() });
    if ((await watchingCount(s.id)) >= MAX_WATCHING) return fail("full", "Too many people are watching right now.");
    const id = newId();
    await insert("snapcal_live_signals", { id, live_id: s.id, viewer: me, camera: false, offer });
    return { ok: true, signal: id };
  }

  if (op === "liveWait" || op === "liveLeave") {
    const [sig] = await select("snapcal_live_signals", { select: "id,live_id,viewer,answer,left_at", id: `eq.${String(body.signal ?? "")}`, limit: "1" });
    if (!sig || sig.viewer !== me) return fail("other", "No such seat.");
    if (op === "liveLeave") {
      await patch("snapcal_live_signals", { id: `eq.${sig.id}` }, { left_at: new Date().toISOString() });
      return { ok: true };
    }
    await patch("snapcal_live_signals", { id: `eq.${sig.id}` }, { last_seen: new Date().toISOString() });
    const s = await session(sig.live_id);
    return { ok: true, answer: sig.answer ?? null, ended: !isAlive(s) };
  }

  return null;
}

// what the notification calls each workout (the app has its own copies in i18n)
const LABELS = {
  en: { chest: "chest", back: "back", legs: "legs", shoulders: "shoulders", arms: "arms", core: "core", full: "full body", cardio: "cardio" },
  es: { chest: "pecho", back: "espalda", legs: "piernas", shoulders: "hombros", arms: "brazos", core: "abdomen", full: "cuerpo completo", cardio: "cardio" },
};
