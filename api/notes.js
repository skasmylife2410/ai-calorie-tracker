// api/notes.js — members leave each other a note that shows on the recipient's Home.
//
// POST { op: "send", to, body }   -> { ok }            (you can't send to yourself)
// POST { op: "inbox" }            -> { ok, notes }     newest first, last 7 days, to you
// POST { op: "seen", id }         -> { ok }            mark one of YOUR notes as read
// POST { op: "people" }           -> { ok, people }    who you can send to
//
// Limits keep it a nudge, not a chat: 200 characters, 20 notes a day per sender.
//
// Push notifications live here too (the Hobby plan caps the number of functions):
// POST { op: "pushKey" }                          -> { ok, key|null }  VAPID public key
// POST { op: "pushSubscribe", sub, lang }         -> { ok }            save this phone
// POST { op: "pushUnsubscribe", endpoint }        -> { ok }            forget this phone
// POST { op: "announce", title:{en,es}, body:{en,es}, test? } (admins) -> { ok, sent }
//      test:true sends only to the admin's own phones, to preview it first.

import { checkAuth } from "./_auth.js";
import { select, insert, patch, remove, parseBody, newId, restBase } from "./_rest.js";
import { myGroups, membersOf, sharesGroup } from "./_groups.js";
import { notify, displayName, publicKey, pushConfigured } from "./_push.js";
import { isAdmin } from "./_members.js";
import { restHeaders } from "./_rest.js";

/** Push services the app may hand us; anything else is refused so the server can't be aimed elsewhere. */
const PUSH_HOSTS = /(^|\.)(push\.apple\.com|fcm\.googleapis\.com|googleapis\.com|push\.services\.mozilla\.com|notify\.windows\.com)$/;

const MAX_LEN = 200;
const PER_DAY = 20;

const fail = (res, errorType, message, status = 200) => res.status(status).json({ ok: false, errorType, message });

export default async function handler(req, res) {
  const me = checkAuth(req, res);
  if (!me) return;
  if (req.method !== "POST") return fail(res, "other", "Method not allowed", 405);
  if (!restBase()) return fail(res, "unconfigured", "Notes need Supabase configured.");

  const body = parseBody(req);
  const op = String(body.op ?? "inbox");

  try {
    if (op === "people") {
      // everyone in your groups, once, minus yourself
      const groups = await myGroups(me);
      const lists = await Promise.all(groups.map((g) => membersOf(g.id)));
      const people = [...new Set(lists.flat())].filter((u) => u !== me);
      return res.status(200).json({ ok: true, people });
    }

    if (op === "inbox") {
      const since = new Date(Date.now() - 7 * 86400000).toISOString();
      const notes = await select("snapcal_notes", {
        select: "id,from_user,body,created_at,seen_at",
        to_user: `eq.${me}`,
        created_at: `gte.${since}`,
        order: "created_at.desc",
        limit: "20",
      });
      return res.status(200).json({ ok: true, notes });
    }

    if (op === "seen") {
      const id = String(body.id ?? "");
      if (!id) return fail(res, "other", "Missing note id.");
      // only the recipient can mark a note as seen
      await patch("snapcal_notes", { id: `eq.${id}`, to_user: `eq.${me}` }, { seen_at: new Date().toISOString() });
      return res.status(200).json({ ok: true });
    }

    if (op === "send") {
      const to = String(body.to ?? "").trim().toLowerCase();
      const text = String(body.body ?? "").trim().replace(/\s+/g, " ");
      if (!text) return fail(res, "empty", "Write something first.");
      if (text.length > MAX_LEN) return fail(res, "tooLong", `Keep it under ${MAX_LEN} characters.`);
      if (to === me) return fail(res, "self", "You can't send a note to yourself.");

      const exists = await select("snapcal_users", { select: "username", username: `eq.${to}`, limit: "1" });
      // Same answer whether they don't exist or are simply in another group: someone in Work
      // shouldn't be able to discover who's in Family by probing names.
      if (exists.length === 0 || !(await sharesGroup(me, to))) {
        return fail(res, "noSuchUser", "That person isn't in your groups.");
      }

      const today = new Date(); today.setUTCHours(0, 0, 0, 0);
      const sentToday = await select("snapcal_notes", { select: "id", from_user: `eq.${me}`, created_at: `gte.${today.toISOString()}`, limit: String(PER_DAY + 1) });
      if (sentToday.length >= PER_DAY) return fail(res, "limit", "That's enough notes for today.");

      await insert("snapcal_notes", { id: newId(), from_user: me, to_user: to, body: text });
      const who = await displayName(me);
      await notify([to], (lang) => ({ title: lang === "es" ? `Nota de ${who}` : `Note from ${who}`, body: text, url: "/", tag: `note-${me}` }));
      return res.status(200).json({ ok: true });
    }

    if (op === "pushKey") {
      return res.status(200).json({ ok: true, key: pushConfigured() ? publicKey() : null });
    }

    if (op === "pushSubscribe") {
      const sub = body.sub ?? {};
      const endpoint = String(sub.endpoint ?? "");
      const p256dh = String(sub.keys?.p256dh ?? "");
      const auth = String(sub.keys?.auth ?? "");
      let host = "";
      try { host = new URL(endpoint).protocol === "https:" ? new URL(endpoint).hostname : ""; } catch {}
      if (!PUSH_HOSTS.test(host) || endpoint.length > 1000 || !/^[A-Za-z0-9_-]{80,100}$/.test(p256dh) || !/^[A-Za-z0-9_-]{16,32}$/.test(auth)) {
        return fail(res, "badSubscription", "That notification subscription doesn't look right.");
      }
      const lang = body.lang === "es" ? "es" : "en";
      // one row per phone; re-subscribing (or a phone changing hands) moves it to the caller
      const r = await fetch(`${restBase()}/rest/v1/snapcal_push_subs?on_conflict=endpoint`, {
        method: "POST",
        headers: restHeaders({ Prefer: "resolution=merge-duplicates,return=minimal" }),
        body: JSON.stringify([{ endpoint, owner: me, p256dh, auth, lang }]),
      });
      if (!r.ok) throw new Error(`Supabase push subscribe failed (${r.status})`);
      return res.status(200).json({ ok: true });
    }

    if (op === "pushUnsubscribe") {
      const endpoint = String(body.endpoint ?? "");
      if (endpoint) await remove("snapcal_push_subs", { endpoint: `eq.${endpoint}`, owner: `eq.${me}` });
      return res.status(200).json({ ok: true });
    }

    if (op === "announce") {
      if (!isAdmin(me)) return fail(res, "forbidden", "Only admins can send announcements.");
      const clip = (v, n) => String(v ?? "").trim().slice(0, n);
      const title = { en: clip(body.title?.en, 80), es: clip(body.title?.es, 80) };
      const text = { en: clip(body.body?.en, 200), es: clip(body.body?.es, 200) };
      if (!title.en || !text.en) return fail(res, "empty", "Needs at least an English title and message.");
      const people = body.test ? [me] : (await select("snapcal_users", { select: "username", limit: "100" })).map((u) => u.username);
      const out = await notify(people, (lang) => ({ title: title[lang] || title.en, body: text[lang] || text.en, url: "/?whatsnew=1", tag: "whatsnew" }));
      return res.status(200).json({ ok: true, ...out });
    }

    return fail(res, "other", "Unknown operation.");
  } catch (err) {
    return fail(res, "other", err?.message ?? String(err));
  }
}
