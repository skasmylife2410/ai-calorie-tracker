// live.js — "Train together" on the Us tab: go live for your group while you work out, and
// everyone else swipes through whoever is live, one full-screen stream at a time (like a feed of
// live videos). It's watching, not a video call: viewers send no camera or sound. Everyone sees
// everyone, whatever their level; the level shown comes from each person's exercise log
// (api/_live.js levelFromLog), never from a choice.
//
// The look (Figma "Boca0 · Live redesign", direction A "Instrument"): the video edge to edge, the
// time live and the watchers as dot-matrix numbers, the workout as the big word, plain comments,
// and a dot rail for your place in the feed.
//
// The video goes straight between phones (WebRTC). The server (api/_live.js via /api/groups) only
// says who is live and passes each viewer's connection offer and the answer, once. The person
// who's live sends one copy of their video to each viewer, so a stream holds ten viewers at most
// (MAX_WATCHING on the server). Nothing is recorded.

import { t } from "../i18n.js";
import { apiFetch } from "../net.js";
import { icon } from "./icons.js";
import { openSheet, openFullScreenCover, navBar, wireNavBar } from "./sheet.js";
import { loadPlans, plansHtml, wirePlans } from "./plans.js";

export const MUSCLES = ["chest", "back", "legs", "shoulders", "arms", "core", "full", "cardio"];
export const LEVELS = ["beginner", "average", "expert"];
const BEAT_MS = 2500;      // the live phone asks for new viewers this often
const VIEW_BEAT_MS = 5000; // a viewer says "still here" this often
const FEED_REFRESH_MS = 15000; // new streams join the feed while you're in it
const TICK_MS = 1000;           // the live clock
const ANSWER_WAIT_MS = 25000;
const CARD_REFRESH_MS = 20000;
const ICE_WAIT_MS = 3000;
// each viewer gets their own copy of the video from the phone that's live, so each copy is kept
// light: ten viewers at this rate is about 5 Mbps of upload, which a phone on 4G can manage
const VIDEO_KBPS = 500;
const FALLBACK_ICE = [{ urls: ["stun:stun.l.google.com:19302"] }];

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(body) {
  try {
    const res = await apiFetch("/api/groups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return await res.json();
  } catch {
    return { ok: false, errorType: "network" };
  }
}

/** "Chest · Beginner" in the app's language. */
export function workoutLabel(muscle, level) {
  return `${t(`live.muscles.${muscle}`)} · ${t(`live.levels.${level}`)}`;
}

/** Whether this phone can take part at all (camera and WebRTC). */
export function liveSupported(g = globalThis) {
  return Boolean(g.RTCPeerConnection && g.navigator?.mediaDevices?.getUserMedia);
}

/** How long someone has been live: "4:07", "24:13", "1:02:09". */
export function elapsed(startedAt, now = Date.now()) {
  const sec = Math.max(0, Math.floor((now - Date.parse(startedAt)) / 1000)) || 0;
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), x = sec % 60;
  const two = (n) => String(n).padStart(2, "0");
  return h ? `${h}:${two(m)}:${two(x)}` : `${m}:${two(x)}`;
}

/** Watchers as the dot-matrix counter shows them: two digits. */
export const twoDigits = (n) => String(Math.max(0, Math.min(99, Number(n) || 0))).padStart(2, "0");

// Waits until the connection has gathered its addresses, so one offer/answer carries everything
// (no trickling back and forth through the server). Gives up waiting after a few seconds.
function iceDone(pc) {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => { if (pc.iceGatheringState === "complete") { pc.removeEventListener("icegatheringstatechange", done); resolve(); } };
    pc.addEventListener("icegatheringstatechange", done);
    setTimeout(resolve, ICE_WAIT_MS);
  });
}

// Video only. The microphone is asked for only when it's turned on: opening it at all makes
// phones (iPhones above all) pause whatever music is playing, and most people train to their own.
async function camera(facing = "user") {
  return navigator.mediaDevices.getUserMedia({
    // upright, like the phone is held (or propped up) while streaming
    video: { facingMode: facing, width: { ideal: 480 }, height: { ideal: 640 }, frameRate: { ideal: 24, max: 30 } },
  });
}
async function microphone() {
  const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  return s.getAudioTracks()[0];
}

// The viewer's choice of sound, kept between lives: off by default, so your own music keeps playing.
export const SOUND_KEY = "snapcal.liveSound";
export function soundWanted(storage = globalThis.localStorage) {
  try { return storage?.getItem(SOUND_KEY) === "1"; } catch { return false; }
}
// The person going live: whether they had the mic on last time (then it starts on again).
const MIC_KEY = "snapcal.liveMic";
function micWanted() { try { return localStorage.getItem(MIC_KEY) === "1"; } catch { return false; } }
function rememberMic(on) { try { localStorage.setItem(MIC_KEY, on ? "1" : "0"); } catch { /* private mode */ } }
function rememberSound(on) { try { localStorage.setItem(SOUND_KEY, on ? "1" : "0"); } catch { /* private mode */ } }

async function capVideo(pc) {
  for (const sender of pc.getSenders()) {
    if (sender.track?.kind !== "video") continue;
    try {
      const params = sender.getParameters();
      params.encodings = params.encodings?.length ? params.encodings : [{}];
      params.encodings.forEach((e) => { e.maxBitrate = VIDEO_KBPS * 1000; });
      await sender.setParameters(params);
    } catch { /* the browser picks its own rate */ }
  }
}

async function keepAwake() {
  try { return await navigator.wakeLock?.request("screen"); } catch { return null; }
}

// --- comments (like a live on Instagram) ---------------------------------------------------
// Comments ride the same direct connection as the video (a WebRTC data channel), so they never
// touch the server and are gone when the live ends. Viewers send theirs to the person who's live,
// whose phone passes each one on to everyone watching, with the sender's name as the server gave
// it (nobody can post as someone else). Someone who arrives late gets the last few.

export const COMMENT_MAX = 150;
const HISTORY = 20;
const COMMENT_GAP_MS = 700; // one comment per viewer this often, at most
const SHOWN = 30;           // comments kept on screen

/** A comment as typed, tidied: one line, trimmed, not too long; "" when there's nothing to send. */
export function cleanComment(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim().slice(0, COMMENT_MAX);
}

/**
 * The live phone's side of the comments: who's connected, the recent ones, and passing each new
 * one on to everyone. `channels` are data channels (or anything with send and readyState).
 */
export function chatRoom({ now = () => Date.now() } = {}) {
  const channels = new Map(); // signal id -> { dc, name, last }
  const history = [];
  const listeners = [];
  const broadcast = (msg) => {
    const text = JSON.stringify(msg);
    for (const c of channels.values()) if (c.dc.readyState === "open") { try { c.dc.send(text); } catch { /* gone */ } }
    for (const fn of listeners) fn(msg);
  };
  const remember = (msg) => { history.push(msg); if (history.length > HISTORY) history.shift(); };
  return {
    onMessage(fn) { listeners.push(fn); },
    /** A viewer's channel opened: catch them up, and tell everyone they're here. */
    join(id, dc, name) {
      channels.set(id, { dc, name, last: 0 });
      try { dc.send(JSON.stringify({ type: "history", items: history })); } catch { /* not open yet */ }
      broadcast({ type: "join", name });
    },
    leave(id) { channels.delete(id); },
    /** Something a viewer sent. Comments and hearts only, and not too fast. */
    receive(id, raw) {
      const c = channels.get(id);
      if (!c) return;
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      if (msg?.type === "heart") return broadcast({ type: "heart" });
      if (msg?.type !== "comment") return;
      const text = cleanComment(msg.text);
      if (!text || now() - c.last < COMMENT_GAP_MS) return;
      c.last = now();
      const out = { type: "comment", name: c.name, text };
      remember(out);
      broadcast(out);
    },
    /** The person who's live says something too. */
    say(text) {
      const clean = cleanComment(text);
      if (!clean) return;
      const out = { type: "comment", host: true, text: clean };
      remember(out);
      broadcast(out);
    },
    get size() { return channels.size; },
  };
}

function commentHtml(msg, hostName) {
  if (msg.type === "join") return `<div class="lv-c is-join">${esc(t("live.joined", { name: msg.name }))}</div>`;
  const who = msg.host ? hostName : msg.name;
  return `<div class="lv-c${msg.host ? " is-host" : ""}"><span class="lv-c-who">${esc(who)}</span><span class="lv-c-text">${esc(msg.text)}</span></div>`;
}

// a heart drawn in dots, like the numbers
const HEART_ROWS = [".XX.XX.", "XXXXXXX", "XXXXXXX", ".XXXXX.", "..XXX..", "...X..."];
export function dotHeart(size = 28) {
  const cell = 10;
  const dots = HEART_ROWS.flatMap((row, y) => [...row].map((c, x) => (c === "X" ? `<circle cx="${x * cell + 5}" cy="${y * cell + 5}" r="3.8"/>` : ""))).join("");
  return `<svg class="lv-dotheart" width="${size}" height="${Math.round(size * 6 / 7)}" viewBox="0 0 70 60" fill="currentColor" aria-hidden="true">${dots}</svg>`;
}

/** Draws incoming comments, joins and hearts into a stream's overlay. */
function chatView(root, hostName) {
  const list = root.querySelector(".lv-comments");
  const hearts = root.querySelector(".lv-hearts");
  const add = (msg) => {
    list.insertAdjacentHTML("beforeend", commentHtml(msg, hostName));
    while (list.children.length > SHOWN) list.firstElementChild.remove();
    list.scrollTop = list.scrollHeight;
  };
  return {
    show(msg) {
      if (msg.type === "history") (msg.items ?? []).forEach(add);
      else if (msg.type === "heart") {
        const h = document.createElement("i");
        h.className = "lv-heart";
        h.style.setProperty("--dx", `${Math.round(Math.random() * 24 - 12)}px`);
        h.innerHTML = dotHeart(22);
        hearts.appendChild(h);
        setTimeout(() => h.remove(), 1800);
      } else add(msg);
    },
    clear() { list.innerHTML = ""; hearts.innerHTML = ""; },
  };
}

/** The top line of a live: how long it's been on and how many are watching, in dot-matrix. */
function instrumentHtml({ close = false, sound = null } = {}) {
  return `
    <div class="lv-inst">
      ${close ? `<button type="button" class="lv-down" data-lv-close aria-label="${t("live.leave")}">${icon("chevronDown", { size: 22 })}</button>` : ""}
      <i class="lv-dot" aria-hidden="true"></i>
      <b class="lv-clock" aria-label="${t("live.badge")}">0:00</b>
      ${sound === null ? "" : soundButtonHtml(sound)}
      <span class="lv-watch"><b class="lv-num">00</b><small>${t("live.watchingLabel")}</small></span>
    </div>`;
}
function soundButtonHtml(on) {
  return `<button type="button" class="lv-mute" data-lv-sound aria-pressed="${on}" aria-label="${t(on ? "live.soundOn" : "live.soundOff")}">
    ${icon(on ? "speaker" : "speakerSlash", { size: 18 })}<span>${t(on ? "live.soundOnShort" : "live.soundOffShort")}</span></button>`;
}

// --- the Us tab pulses while someone is live ------------------------------------------------------

const BADGE_MS = 60 * 1000;
/** Marks the page (html[data-someone-live]) so the Us tab can pulse; true when someone else is live. */
export function markLive(sessions, mine = null) {
  const on = (sessions ?? []).some((s) => s.id !== mine);
  if (on) document.documentElement.dataset.someoneLive = "1";
  else delete document.documentElement.dataset.someoneLive;
  return on;
}
let badgeTimer = null;
/** Checks who's live now and then (only while the app is on screen) for the Us tab's pulse. */
export function watchLive() {
  if (badgeTimer) return;
  const check = async () => {
    if (document.visibilityState === "hidden") return;
    const out = await api({ op: "live" });
    if (out.ok) markLive(out.sessions, out.mine);
  };
  check();
  badgeTimer = setInterval(check, BADGE_MS);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") check(); });
}

// --- the card on Us ------------------------------------------------------------------------

let pendingLive = null; // a notification asked to open this stream
let lastIce = FALLBACK_ICE;

/** A "X is live" notification was tapped: open the feed at that stream once the Us card has loaded. */
export function wantLive(id) { pendingLive = id || null; }

/** Who's live in any of your groups (a tile each, tap to watch), and going live yourself. */
export function renderLiveCard(el, { group } = {}) {
  if (!el || !group?.id) return;
  let timer = null;
  const draw = async () => {
    if (!el.isConnected) { clearInterval(timer); return; }
    if (document.visibilityState === "hidden") return;
    const [out, plans] = await Promise.all([api({ op: "live" }), loadPlans()]);
    if (!el.isConnected || !out.ok) return;
    lastIce = out.ice?.length ? out.ice : FALLBACK_ICE;
    markLive(out.sessions, out.mine);
    const others = out.sessions.filter((s) => s.id !== out.mine);
    const mineLive = out.sessions.some((s) => s.id === out.mine);
    // nobody live: one line and a Go live button; people live: their tiles under the same line
    el.innerHTML = `
      <div class="lv-card card${others.length ? "" : " is-quiet"}">
        <div class="lv-head">
          <div class="lv-head-text">
            <b>${t("live.title")}</b>
            <span>${others.length ? `<i class="lv-dot" aria-hidden="true"></i>${t("live.liveNow", { n: others.length })}` : mineLive ? t("live.youreLive") : t("live.nobody")}</span>
          </div>
          ${mineLive ? "" : `<button type="button" class="lv-go" data-lv-go><i class="lv-dot" aria-hidden="true"></i>${t("live.goLive")}</button>`}
        </div>
        ${others.length ? `<div class="lv-tiles-row" role="list">
          ${others.map((s) => `
            <button type="button" class="lv-tile" role="listitem" data-lv-open="${esc(s.id)}">
              <span class="lv-tile-pic">
                <span class="lv-tile-time"><i class="lv-dot" aria-hidden="true"></i><b data-started="${esc(s.startedAt)}">${elapsed(s.startedAt)}</b></span>
                <b class="lv-tile-word">${esc(t(`live.muscles.${s.muscle}`))}</b>
              </span>
              <span class="lv-tile-name">${esc(s.name)}</span>
            </button>`).join("")}
        </div>` : ""}
        ${plansHtml(plans)}
      </div>`;
    wirePlans(el, plans, { group });
    el.querySelector("[data-lv-go]")?.addEventListener("click", () => openGoLive({ group }));
    el.querySelectorAll("[data-lv-open]").forEach((b) => b.addEventListener("click", () => openFeed(others, b.dataset.lvOpen)));
    if (pendingLive) {
      const at = pendingLive;
      pendingLive = null;
      if (others.some((s) => s.id === at)) openFeed(others, at);
    }
  };
  draw();
  timer = setInterval(() => {
    // the tiles' clocks tick between refreshes
    el.querySelectorAll("[data-started]").forEach((b) => { b.textContent = elapsed(b.dataset.started); });
  }, TICK_MS);
  const refresh = setInterval(() => { if (!el.isConnected) clearInterval(refresh); else draw(); }, CARD_REFRESH_MS);
  // a plan made, answered or removed: draw again at once
  const again = () => { if (!el.isConnected) globalThis.removeEventListener("boca0:plans-changed", again); else draw(); };
  globalThis.addEventListener("boca0:plans-changed", again);
}

// --- going live ----------------------------------------------------------------------------

function openGoLive({ group }) {
  let muscle = null;
  let level = null; // from their exercise log, filled in once it's known
  openSheet({
    render: (panel, close) => {
      const draw = () => {
        panel.innerHTML = `
          ${navBar({ title: t("live.title"), leading: { label: t("app.cancel") } })}
          <div class="sheet-panel-body lv-body">
            <div class="ctx-q">${t("live.whatToday")}</div>
            <div class="ctx-kinds" role="group" aria-label="${t("live.whatToday")}">
              ${MUSCLES.map((m) => `<button type="button" class="ctx-chip" data-muscle="${m}" aria-pressed="${m === muscle}">${t(`live.muscles.${m}`)}</button>`).join("")}
            </div>
            <div class="lv-level">
              <span class="ctx-label">${t("live.yourLevel")}</span>
              <b>${level ? t(`live.levels.${level.level}`) : "…"}</b>
              <small>${level ? t("live.levelWhy", { n: level.trainingDays, w: level.weeks }) : ""}</small>
            </div>
            <p class="lv-note">${t("live.who", { group: esc(group.name ?? "") })}</p>
            ${liveSupported() ? "" : `<p class="lv-note is-warn">${t("live.unsupported")}</p>`}
            <button type="button" class="acct-btn is-primary lv-start" id="lv-start" ${muscle && liveSupported() ? "" : "disabled"}>${t("live.goLive")}</button>
          </div>`;
        wireNavBar(panel, { onLeading: close });
        panel.querySelectorAll("[data-muscle]").forEach((b) => b.addEventListener("click", () => { muscle = b.dataset.muscle; draw(); }));
        panel.querySelector("#lv-start").addEventListener("click", () => { close(); startLive({ group, muscle }); });
      };
      draw();
      api({ op: "liveLevel" }).then((out) => { if (out.ok && panel.isConnected) { level = out; draw(); } });
    },
  });
}

function startLive({ group, muscle }) {
  let stream = null;
  let sessionId = null;
  let ended = false;
  let facing = "user";
  let micOn = false;
  let mic = null; // the microphone track, only while it's on
  let lock = null;
  let tick = null;
  const peers = new Map(); // signal id -> RTCPeerConnection
  const room = chatRoom();

  const stopAll = () => {
    clearInterval(tick);
    for (const pc of peers.values()) pc.close();
    stream?.getTracks().forEach((tr) => tr.stop());
    mic?.stop();
    lock?.release?.().catch?.(() => {});
  };
  // each viewer's sound slot: carries the mic while it's on, nothing otherwise
  const audioSender = (pc) => pc.getTransceivers().find((tr) => tr.receiver?.track?.kind === "audio")?.sender;

  openFullScreenCover({
    render: (panel, close) => {
      panel.classList.add("lv-cover");
      panel.innerHTML = `
        <video class="lv-bg is-mirror" id="lv-self-bg" autoplay playsinline muted aria-hidden="true"></video>
        <video class="lv-main is-mirror" id="lv-self" autoplay playsinline muted></video>
        <div class="lv-shade" aria-hidden="true"></div>
        ${instrumentHtml()}
        <div class="lv-status" id="lv-status">${t("live.starting")}</div>
        <div class="lv-bottom is-host">
          <div class="lv-hearts" aria-hidden="true"></div>
          <div class="lv-comments" aria-live="polite"></div>
          <div class="lv-word" id="lv-word">${esc(t(`live.muscles.${muscle}`))}</div>
          <div class="lv-meta" id="lv-meta">${t("live.you")}</div>
          <div class="lv-michint" id="lv-michint">${t("live.micHint")}</div>
          <div class="lv-host-row">
            <form class="lv-say" autocomplete="off">
              <input class="lv-input" name="c" maxlength="${COMMENT_MAX}" enterkeyhint="send" placeholder="${t("live.reply")}" aria-label="${t("live.reply")}" />
            </form>
            <button type="button" class="lv-micbtn" id="lv-mic" aria-pressed="false">${icon("mic", { size: 17 })}<span class="lv-mic-label">${t("live.micOffShort")}</span></button>
            <button type="button" class="lv-round" id="lv-flip" aria-label="${t("live.flip")}">${icon("cameraFill", { size: 19 })}</button>
          </div>
          <button type="button" class="lv-end" id="lv-end">${t("live.end")}</button>
        </div>`;
      const $ = (id) => panel.querySelector(`#${id}`);
      const status = (key) => { $("lv-status").textContent = key ? t(key) : ""; $("lv-status").hidden = !key; };
      const startedAt = new Date().toISOString();
      tick = setInterval(() => { panel.querySelector(".lv-clock").textContent = elapsed(startedAt); }, TICK_MS);

      $("lv-end").addEventListener("click", async () => {
        if (ended) return;
        ended = true;
        stopAll();
        if (sessionId) await api({ op: "liveEnd", id: sessionId });
        close();
      });
      const setMic = async (on) => {
        if (on && !mic) {
          try { mic = await microphone(); } catch { status("live.noMic"); setTimeout(() => status(""), 3000); return; }
        }
        if (!on && mic) { mic.stop(); mic = null; } // let go of it entirely, so music can play again
        micOn = Boolean(on && mic);
        for (const pc of peers.values()) audioSender(pc)?.replaceTrack(micOn ? mic : null).catch(() => {});
        $("lv-mic").setAttribute("aria-pressed", String(micOn));
        $("lv-mic").setAttribute("aria-label", t(micOn ? "live.micOn" : "live.micOff"));
        $("lv-mic").querySelector(".lv-mic-label").textContent = t(micOn ? "live.micOnShort" : "live.micOffShort");
        $("lv-michint").hidden = micOn;
        rememberMic(micOn);
      };
      $("lv-mic").addEventListener("click", () => setMic(!micOn));
      $("lv-flip").addEventListener("click", async () => {
        try {
          facing = facing === "user" ? "environment" : "user";
          const fresh = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 480 }, height: { ideal: 640 } } });
          const track = fresh.getVideoTracks()[0];
          const old = stream.getVideoTracks()[0];
          for (const pc of peers.values()) pc.getSenders().find((s) => s.track?.kind === "video")?.replaceTrack(track);
          stream.removeTrack(old); old.stop(); stream.addTrack(track);
          $("lv-self").classList.toggle("is-mirror", facing === "user");
          $("lv-self-bg").classList.toggle("is-mirror", facing === "user");
        } catch { /* keep the camera it had */ }
      });

      const chat = chatView(panel, t("live.you"));
      room.onMessage((msg) => chat.show(msg));
      const form = panel.querySelector(".lv-say");
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        room.say(form.c.value);
        form.c.value = "";
      });

      const drop = (sig) => { peers.get(sig)?.close(); peers.delete(sig); room.leave(sig); };
      const answer = async (o) => {
        const pc = new RTCPeerConnection({ iceServers: lastIce });
        peers.set(o.id, pc);
        pc.addEventListener("datachannel", (e) => {
          const dc = e.channel;
          const hello = () => room.join(o.id, dc, o.name);
          if (dc.readyState === "open") hello(); else dc.addEventListener("open", hello);
          dc.addEventListener("message", (m) => room.receive(o.id, m.data));
          dc.addEventListener("close", () => room.leave(o.id));
        });
        stream.getVideoTracks().forEach((tr) => pc.addTrack(tr, stream));
        pc.addEventListener("connectionstatechange", () => { if (["failed", "closed"].includes(pc.connectionState)) drop(o.id); });
        await pc.setRemoteDescription({ type: "offer", sdp: o.offer });
        const sound = pc.getTransceivers().find((tr) => tr.receiver?.track?.kind === "audio");
        if (sound) { sound.direction = "sendonly"; if (micOn && mic) await sound.sender.replaceTrack(mic); }
        await pc.setLocalDescription(await pc.createAnswer());
        await capVideo(pc);
        await iceDone(pc);
        await api({ op: "liveAnswer", signal: o.id, answer: pc.localDescription.sdp });
      };

      (async () => {
        try {
          stream = await camera(facing);
        } catch {
          status("live.noCamera");
          return;
        }
        if (ended) { stream.getTracks().forEach((tr) => tr.stop()); return; }
        $("lv-self").srcObject = stream;
        $("lv-self-bg").srcObject = stream;
        if (micWanted()) setMic(true); // they talked last time: the mic comes back on
        const out = await api({ op: "liveStart", group: group.id, muscle });
        if (!out.ok) { status(out.errorType === "network" ? "live.offline" : "live.failed"); return; }
        sessionId = out.id;
        if (out.level) $("lv-meta").textContent = `${t("live.you")} · ${t(`live.levels.${out.level}`)} · ${group.name ?? ""}`;
        lock = await keepAwake();
        status("live.waiting");
        while (!ended) {
          const beat = await api({ op: "liveBeat", id: sessionId });
          if (ended) break;
          if (beat.ok) {
            if (beat.ended) break;
            for (const o of beat.offers ?? []) if (!peers.has(o.id)) answer(o).catch(() => drop(o.id));
            for (const id of beat.left ?? []) if (peers.has(id)) drop(id);
            panel.querySelector(".lv-num").textContent = twoDigits(beat.watching);
            status(beat.watching ? "" : "live.waiting");
          }
          await sleep(BEAT_MS);
        }
      })();
      // the screen lock comes back after the phone was put away
      document.addEventListener("visibilitychange", async () => { if (!ended && document.visibilityState === "visible") lock = await keepAwake(); });
    },
    onClosed: () => { if (!ended) { ended = true; stopAll(); if (sessionId) api({ op: "liveEnd", id: sessionId }); } },
  });
}

// --- the feed: swipe through whoever is live ----------------------------------------------

/** One stream on screen: connects when it's shown, lets go when you swipe past. */
function watcher(slide, s, { sound = () => false, onAutoplayBlocked = () => {}, onWantSound = () => {} } = {}) {
  let pc = null;
  let dc = null;
  let signal = null;
  let stopped = false;
  const chat = chatView(slide, s.name);
  const form = slide.querySelector(".lv-say");
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = cleanComment(form.c.value);
    if (!text || dc?.readyState !== "open") return;
    dc.send(JSON.stringify({ type: "comment", text }));
    form.c.value = "";
  });
  slide.querySelector(".lv-like").addEventListener("click", () => {
    if (dc?.readyState === "open") dc.send(JSON.stringify({ type: "heart" }));
  });
  const video = slide.querySelector("video.lv-main");
  const status = (key) => { const el = slide.querySelector(".lv-status"); el.textContent = key ? t(key) : ""; el.hidden = !key; };
  const stop = () => {
    stopped = true;
    pc?.close();
    pc = null;
    dc = null;
    chat.clear();
    video.srcObject = null;
    slide.querySelector(".lv-bg").srcObject = null;
    if (signal) api({ op: "liveLeave", signal });
    signal = null;
  };
  const start = async () => {
    stopped = false;
    status("live.connecting");
    pc = new RTCPeerConnection({ iceServers: lastIce });
    const mine = pc;
    pc.addTransceiver("video", { direction: "recvonly" });
    pc.addTransceiver("audio", { direction: "recvonly" });
    const channel = pc.createDataChannel("chat");
    dc = channel;
    channel.addEventListener("message", (m) => {
      if (mine !== pc) return;
      try { chat.show(JSON.parse(m.data)); } catch { /* not a message */ }
    });
    // picture and sound arrive as separate tracks (the sound only once their mic is on): one stream holds both
    const media = new MediaStream();
    pc.addEventListener("track", (e) => {
      if (mine !== pc) return;
      media.addTrack(e.track);
      if (e.track.kind === "audio") {
        // their voice is coming through (their mic is on): offer the sound if this phone is muted
        const check = () => { hear.hidden = !(video.muted && !e.track.muted); };
        e.track.addEventListener("unmute", check);
        e.track.addEventListener("mute", check);
        setTimeout(check, 0);
      }
      if (video.srcObject !== media) {
        video.srcObject = media;
        // the whole picture, never cropped: a soft blurred copy fills the edges around it
        const bg = slide.querySelector(".lv-bg");
        bg.srcObject = new MediaStream(media.getVideoTracks());
        bg.play().catch(() => {});
      }
      video.muted = !sound();
      // a phone that won't play sound without a tap plays muted, and the button says so
      video.play().catch(() => { video.muted = true; video.play().catch(() => {}); onAutoplayBlocked(); });
      status("");
    });
    pc.addEventListener("connectionstatechange", () => {
      if (mine !== pc) return;
      if (pc.connectionState === "failed") status("live.blocked");
      if (pc.connectionState === "disconnected") status("live.reconnecting");
      if (pc.connectionState === "connected") status("");
    });
    await pc.setLocalDescription(await pc.createOffer());
    await iceDone(pc);
    if (stopped || mine !== pc) return;
    const join = await api({ op: "liveJoin", id: s.id, offer: pc.localDescription.sdp });
    if (stopped || mine !== pc) { if (join.ok) api({ op: "liveLeave", signal: join.signal }); return; }
    if (!join.ok) { status(join.errorType === "ended" ? "live.over" : join.errorType === "full" ? "live.full" : join.errorType === "network" ? "live.offline" : "live.failed"); return; }
    signal = join.signal;
    const until = Date.now() + ANSWER_WAIT_MS;
    let answered = false;
    while (!stopped && mine === pc) {
      const w = await api({ op: "liveWait", signal });
      if (stopped || mine !== pc) break;
      if (w.ok && w.ended) { status("live.over"); pc.close(); break; }
      if (w.ok && w.answer && !answered) {
        answered = true;
        await pc.setRemoteDescription({ type: "answer", sdp: w.answer });
      }
      if (!answered && Date.now() > until) { status("live.blocked"); break; }
      await sleep(answered ? VIEW_BEAT_MS : 1000);
    }
  };
  const hear = slide.querySelector(".lv-hear");
  hear.addEventListener("click", () => onWantSound());
  const setSound = (on) => { video.muted = !on; if (on) video.play().catch(() => {}); hear.hidden = true; };
  return { start: () => start().catch(() => status("live.failed")), stop, setSound };
}

function slideHtml(s) {
  return `
    <section class="lv-slide" data-id="${esc(s.id)}" data-started="${esc(s.startedAt ?? "")}">
      <video class="lv-bg" autoplay playsinline muted aria-hidden="true"></video>
      <video class="lv-main" autoplay playsinline></video>
      <div class="lv-shade" aria-hidden="true"></div>
      <div class="lv-status" hidden></div>
      <button type="button" class="lv-hear" hidden>${icon("speaker", { size: 20 })}<span>${esc(t("live.tapToHear", { name: s.name }))}</span></button>
      <div class="lv-bottom">
        <div class="lv-hearts" aria-hidden="true"></div>
        <div class="lv-comments" aria-live="polite"></div>
        <div class="lv-word">${esc(t(`live.muscles.${s.muscle}`))}</div>
        <div class="lv-meta">${esc(s.name)} · ${esc(t(`live.levels.${s.level}`))}${s.group ? ` · ${esc(s.group)}` : ""}</div>
        <form class="lv-say" autocomplete="off">
          <input class="lv-input" name="c" maxlength="${COMMENT_MAX}" enterkeyhint="send" placeholder="${t("live.commentPlaceholder")}" aria-label="${t("live.commentPlaceholder")}" />
          <button type="button" class="lv-like" aria-label="${t("live.heart")}">${dotHeart(28)}</button>
        </form>
      </div>
    </section>`;
}

/** Full screen, one live stream at a time; swipe up or down for the next person. */
function openFeed(list, startId) {
  let sessions = [...list];
  let lock = null;
  let refresh = null;
  let tick = null;
  const watchers = new Map(); // id -> watcher
  let current = null;
  let soundOn = soundWanted();

  openFullScreenCover({
    render: (panel, close) => {
      panel.classList.add("lv-cover");
      panel.innerHTML = `
        <div class="lv-feed" id="lv-feed"></div>
        ${instrumentHtml({ close: true, sound: soundWanted() })}
        <div class="lv-rail" id="lv-rail" aria-hidden="true"></div>`;
      const feed = panel.querySelector("#lv-feed");
      const rail = panel.querySelector("#lv-rail");
      const clock = panel.querySelector(".lv-clock");
      const num = panel.querySelector(".lv-num");

      const drawTop = () => {
        const s = sessions.find((x) => x.id === current);
        clock.textContent = s?.startedAt ? elapsed(s.startedAt) : "0:00";
        num.textContent = twoDigits(s?.watching);
        const slides = [...feed.querySelectorAll(".lv-slide")];
        rail.innerHTML = slides.length > 1 ? slides.map((sl) => `<i class="${sl.dataset.id === current ? "is-on" : ""}"></i>`).join("") : "";
      };
      // the stream's sound: off keeps your own music going; the choice is remembered
      const drawSound = (on) => {
        soundOn = on;
        panel.querySelector("[data-lv-sound]").outerHTML = soundButtonHtml(on);
        panel.querySelector("[data-lv-sound]").addEventListener("click", () => toggleSound());
      };
      const toggleSound = () => {
        const on = !soundOn;
        rememberSound(on);
        drawSound(on);
        watchers.get(current)?.setSound(on);
      };
      panel.querySelector("[data-lv-sound]").addEventListener("click", toggleSound);
      const show = (id) => {
        if (current === id) return;
        if (current) watchers.get(current)?.stop();
        current = id;
        watchers.get(id)?.start();
        drawTop();
      };
      const observer = new IntersectionObserver((entries) => {
        for (const e of entries) if (e.isIntersecting && e.intersectionRatio >= 0.6) show(e.target.dataset.id);
      }, { root: feed, threshold: [0.6] });
      const addSlide = (s) => {
        feed.insertAdjacentHTML("beforeend", slideHtml(s));
        const slide = feed.lastElementChild;
        watchers.set(s.id, watcher(slide, s, { sound: () => soundOn, onAutoplayBlocked: () => drawSound(false), onWantSound: () => { if (!soundOn) toggleSound(); } }));
        observer.observe(slide);
      };

      sessions.forEach(addSlide);
      const at = feed.querySelector(`.lv-slide[data-id="${CSS.escape(startId ?? "")}"]`);
      if (at) feed.scrollTop = at.offsetTop;

      // new streams join at the end, so the one you're watching doesn't jump; counts stay current
      const addNew = async () => {
        const out = await api({ op: "live" });
        if (!out.ok || !panel.isConnected) return;
        for (const s of out.sessions) {
          const known = sessions.find((x) => x.id === s.id);
          if (known) known.watching = s.watching;
          else if (s.id !== out.mine) { sessions.push(s); addSlide(s); }
        }
        drawTop();
      };

      panel.querySelector("[data-lv-close]").addEventListener("click", close);
      keepAwake().then((l) => { lock = l; });
      refresh = setInterval(addNew, FEED_REFRESH_MS);
      tick = setInterval(drawTop, TICK_MS);
    },
    onClosed: () => {
      clearInterval(refresh);
      clearInterval(tick);
      for (const w of watchers.values()) w.stop();
      lock?.release?.().catch?.(() => {});
    },
  });
}
