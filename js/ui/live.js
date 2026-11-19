// live.js — "Train together" on the Us tab: go live for your group while you work out, and
// everyone else swipes through whoever is live, one full-screen stream at a time (like a feed of
// live videos). It's watching, not a video call: viewers send no camera or sound.
//
// The video goes straight between phones (WebRTC). The server (api/_live.js via /api/groups) only
// says who is live and passes each viewer's connection offer and the answer, once. The person
// who's live sends one copy of their video to each viewer, so a stream holds ten viewers at most
// (MAX_WATCHING on the server). Nothing is recorded.

import { t } from "../i18n.js";
import { apiFetch } from "../net.js";
import { icon } from "./icons.js";
import { openSheet, openFullScreenCover, navBar, wireNavBar } from "./sheet.js";

export const MUSCLES = ["chest", "back", "legs", "shoulders", "arms", "core", "full", "cardio"];
export const LEVELS = ["beginner", "average", "expert"];
const BEAT_MS = 2500;      // the live phone asks for new viewers this often
const VIEW_BEAT_MS = 5000; // a viewer says "still here" this often
const FEED_REFRESH_MS = 15000; // new streams join the feed while you're in it
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

/** The feed: streams at your level first (then the newest, as the server sends them); a level filter keeps only that level. */
export function orderSessions(sessions, { level = null, only = null } = {}) {
  const list = (sessions ?? []).filter((s) => !only || s.level === only);
  if (!level) return list;
  return list.map((s, i) => ({ s, i })).sort((a, b) => Number(b.s.level === level) - Number(a.s.level === level) || a.i - b.i).map((x) => x.s);
}

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

async function camera(facing = "user") {
  return navigator.mediaDevices.getUserMedia({
    // upright, like the phone is held (or propped up) while streaming
    video: { facingMode: facing, width: { ideal: 480 }, height: { ideal: 640 }, frameRate: { ideal: 24, max: 30 } },
    audio: { echoCancellation: true, noiseSuppression: true },
  });
}

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

// --- the card on Us ------------------------------------------------------------------------

let pendingLive = null; // a notification asked to open this stream
let lastIce = FALLBACK_ICE;

/** A "X is live" notification was tapped: open the feed at that stream once the Us card has loaded. */
export function wantLive(id) { pendingLive = id || null; }

const myLevel = () => { try { const l = localStorage.getItem("snapcal.liveLevel"); return LEVELS.includes(l) ? l : null; } catch { return null; } };
const initial = (name) => esc(String(name || "?").trim().charAt(0).toUpperCase());

/** Who's live in any of your groups (a row of people, tap to watch), and going live yourself. */
export function renderLiveCard(el, { group } = {}) {
  if (!el || !group?.id) return;
  let timer = null;
  const draw = async () => {
    if (!el.isConnected) { clearInterval(timer); return; }
    if (document.visibilityState === "hidden") return;
    const out = await api({ op: "live" });
    if (!el.isConnected || !out.ok) return;
    lastIce = out.ice?.length ? out.ice : FALLBACK_ICE;
    const others = orderSessions(out.sessions.filter((s) => s.id !== out.mine), { level: myLevel() });
    const mineLive = out.sessions.some((s) => s.id === out.mine);
    el.innerHTML = `
      <div class="lv-card card">
        <div class="lv-head">
          <span class="lv-head-ic" aria-hidden="true">${icon("dumbbell", { size: 16 })}</span>
          <b>${t("live.title")}</b>
          ${others.length ? `<span class="lv-head-n">${t("live.liveNow", { n: others.length })}</span>` : ""}
        </div>
        ${others.length ? `<div class="lv-people" role="list">${others.map((s) => `
          <button type="button" class="lv-person" role="listitem" data-lv-open="${esc(s.id)}">
            <span class="lv-ring"><span class="lv-avatar">${initial(s.name)}</span><span class="lv-tag">${t("live.badge")}</span></span>
            <b>${esc(s.name)}</b>
            <span>${esc(t(`live.muscles.${s.muscle}`))}</span>
          </button>`).join("")}</div>` : `<p class="lv-empty">${t("live.empty")}</p>`}
        ${mineLive ? "" : `<button type="button" class="lv-go" data-lv-go>${icon("cameraFill", { size: 15 })}<span>${t("live.goLive")}</span></button>`}
      </div>`;
    el.querySelector("[data-lv-go]")?.addEventListener("click", () => openGoLive({ group }));
    el.querySelectorAll("[data-lv-open]").forEach((b) => b.addEventListener("click", () => openFeed(others, b.dataset.lvOpen)));
    if (pendingLive) {
      const at = pendingLive;
      pendingLive = null;
      if (others.some((s) => s.id === at)) openFeed(others, at);
    }
  };
  draw();
  timer = setInterval(draw, CARD_REFRESH_MS);
}

// --- going live ----------------------------------------------------------------------------

function openGoLive({ group }) {
  let muscle = null;
  let level = myLevel();
  openSheet({
    render: (panel, close) => {
      const draw = () => {
        const ready = Boolean(muscle && level);
        panel.innerHTML = `
          ${navBar({ title: t("live.title"), leading: { label: t("app.cancel") } })}
          <div class="sheet-panel-body lv-body">
            <div class="ctx-q">${t("live.whatToday")}</div>
            <div class="ctx-kinds" role="group" aria-label="${t("live.whatToday")}">
              ${MUSCLES.map((m) => `<button type="button" class="ctx-chip" data-muscle="${m}" aria-pressed="${m === muscle}">${t(`live.muscles.${m}`)}</button>`).join("")}
            </div>
            <div class="ctx-label">${t("live.yourLevel")}</div>
            <div class="ctx-kinds" role="group" aria-label="${t("live.yourLevel")}">
              ${LEVELS.map((l) => `<button type="button" class="ctx-chip" data-level="${l}" aria-pressed="${l === level}">${t(`live.levels.${l}`)}</button>`).join("")}
            </div>
            <p class="lv-note">${t("live.who", { group: esc(group.name ?? "") })}</p>
            ${liveSupported() ? "" : `<p class="lv-note is-warn">${t("live.unsupported")}</p>`}
            <button type="button" class="acct-btn is-primary lv-start" id="lv-start" ${ready && liveSupported() ? "" : "disabled"}>${t("live.goLive")}</button>
          </div>`;
        wireNavBar(panel, { onLeading: close });
        panel.querySelectorAll("[data-muscle]").forEach((b) => b.addEventListener("click", () => { muscle = b.dataset.muscle; draw(); }));
        panel.querySelectorAll("[data-level]").forEach((b) => b.addEventListener("click", () => { level = b.dataset.level; draw(); }));
        panel.querySelector("#lv-start").addEventListener("click", () => {
          try { localStorage.setItem("snapcal.liveLevel", level); } catch { /* private mode */ }
          close();
          startLive({ group, muscle, level });
        });
      };
      draw();
    },
  });
}

function startLive({ group, muscle, level }) {
  let stream = null;
  let sessionId = null;
  let ended = false;
  let facing = "user";
  let micOn = false;
  let lock = null;
  const peers = new Map(); // signal id -> RTCPeerConnection

  const stopAll = () => {
    for (const pc of peers.values()) pc.close();
    stream?.getTracks().forEach((tr) => tr.stop());
    lock?.release?.().catch?.(() => {});
  };

  openFullScreenCover({
    render: (panel, close) => {
      panel.classList.add("lv-cover");
      panel.innerHTML = `
        <video class="lv-main is-mirror" id="lv-self" autoplay playsinline muted></video>
        <div class="lv-top">
          <span class="lv-badge"><i class="lv-dot" aria-hidden="true"></i>${t("live.badge")}</span>
          <span class="lv-what">${esc(workoutLabel(muscle, level))}</span>
          <span class="lv-count" id="lv-count"></span>
        </div>
        <div class="lv-status" id="lv-status">${t("live.starting")}</div>
        <div class="lv-controls">
          <button type="button" class="lv-ctl" id="lv-mic" aria-pressed="false" aria-label="${t("live.mic")}">${icon("mic", { size: 20 })}</button>
          <button type="button" class="lv-ctl" id="lv-flip" aria-label="${t("live.flip")}">${icon("cameraFill", { size: 20 })}</button>
          <button type="button" class="lv-end" id="lv-end">${t("live.end")}</button>
        </div>`;
      const $ = (id) => panel.querySelector(`#${id}`);
      const status = (key) => { $("lv-status").textContent = key ? t(key) : ""; $("lv-status").hidden = !key; };

      $("lv-end").addEventListener("click", async () => {
        if (ended) return;
        ended = true;
        stopAll();
        if (sessionId) await api({ op: "liveEnd", id: sessionId });
        close();
      });
      const setMic = () => {
        stream?.getAudioTracks().forEach((tr) => { tr.enabled = micOn; });
        $("lv-mic").setAttribute("aria-pressed", String(micOn));
        $("lv-mic").classList.toggle("is-off", !micOn);
      };
      $("lv-mic").addEventListener("click", () => { micOn = !micOn; setMic(); });
      $("lv-flip").addEventListener("click", async () => {
        try {
          facing = facing === "user" ? "environment" : "user";
          const fresh = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 480 }, height: { ideal: 640 } } });
          const track = fresh.getVideoTracks()[0];
          const old = stream.getVideoTracks()[0];
          for (const pc of peers.values()) pc.getSenders().find((s) => s.track?.kind === "video")?.replaceTrack(track);
          stream.removeTrack(old); old.stop(); stream.addTrack(track);
          $("lv-self").classList.toggle("is-mirror", facing === "user");
        } catch { /* keep the camera it had */ }
      });

      const drop = (sig) => { peers.get(sig)?.close(); peers.delete(sig); };
      const answer = async (o) => {
        const pc = new RTCPeerConnection({ iceServers: lastIce });
        peers.set(o.id, pc);
        stream.getTracks().forEach((tr) => pc.addTrack(tr, stream));
        pc.addEventListener("connectionstatechange", () => { if (["failed", "closed"].includes(pc.connectionState)) drop(o.id); });
        await pc.setRemoteDescription({ type: "offer", sdp: o.offer });
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
        setMic();
        const out = await api({ op: "liveStart", group: group.id, muscle, level });
        if (!out.ok) { status(out.errorType === "network" ? "live.offline" : "live.failed"); return; }
        sessionId = out.id;
        lock = await keepAwake();
        status("live.waiting");
        while (!ended) {
          const beat = await api({ op: "liveBeat", id: sessionId });
          if (ended) break;
          if (beat.ok) {
            if (beat.ended) break;
            for (const o of beat.offers ?? []) if (!peers.has(o.id)) answer(o).catch(() => drop(o.id));
            for (const id of beat.left ?? []) if (peers.has(id)) drop(id);
            $("lv-count").textContent = beat.watching ? t("live.watching", { n: beat.watching }) : "";
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
function watcher(slide, s) {
  let pc = null;
  let signal = null;
  let stopped = false;
  const video = slide.querySelector("video");
  const status = (key) => { const el = slide.querySelector(".lv-status"); el.textContent = key ? t(key) : ""; el.hidden = !key; };
  const stop = () => {
    stopped = true;
    pc?.close();
    pc = null;
    video.srcObject = null;
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
    pc.addEventListener("track", (e) => {
      if (mine !== pc) return;
      video.srcObject = e.streams[0] ?? new MediaStream([e.track]);
      video.play().catch(() => { video.muted = true; video.play().catch(() => {}); slide.querySelector(".lv-sound").hidden = false; });
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
  slide.querySelector(".lv-sound").addEventListener("click", (e) => {
    e.currentTarget.hidden = true;
    video.muted = false;
    video.play().catch(() => {});
  });
  return { start: () => start().catch(() => status("live.failed")), stop };
}

function slideHtml(s) {
  return `
    <section class="lv-slide" data-id="${esc(s.id)}">
      <video class="lv-main" autoplay playsinline></video>
      <div class="lv-status" hidden></div>
      <button type="button" class="lv-ctl lv-sound" hidden>${t("live.sound")}</button>
      <div class="lv-info">
        <span class="lv-badge"><i class="lv-dot" aria-hidden="true"></i>${t("live.badge")}${s.watching ? ` · ${t("live.watching", { n: s.watching })}` : ""}</span>
        <b>${esc(s.name)}</b>
        <span>${esc(workoutLabel(s.muscle, s.level))}${s.group ? ` · ${esc(s.group)}` : ""}</span>
      </div>
    </section>`;
}

/** Full screen, one live stream at a time; swipe up or down for the next person. */
function openFeed(list, startId) {
  let sessions = [...list];
  let only = null; // a level filter, or everyone
  let lock = null;
  let refresh = null;
  const watchers = new Map(); // id -> watcher
  let current = null;

  openFullScreenCover({
    render: (panel, close) => {
      panel.classList.add("lv-cover");
      panel.innerHTML = `
        <div class="lv-feed" id="lv-feed"></div>
        <div class="lv-top lv-feed-top">
          <div class="lv-levels" role="group" aria-label="${t("live.yourLevel")}">
            <button type="button" data-only="" aria-pressed="true">${t("live.all")}</button>
            ${LEVELS.map((l) => `<button type="button" data-only="${l}" aria-pressed="false">${t(`live.levels.${l}`)}</button>`).join("")}
          </div>
          <button type="button" class="lv-close" id="lv-close" aria-label="${t("live.leave")}">${icon("xmark", { size: 18 })}</button>
        </div>
        <div class="lv-swipe" id="lv-swipe" hidden>${icon("chevronUp", { size: 16 })}<span>${t("live.swipe")}</span></div>`;
      const feed = panel.querySelector("#lv-feed");

      const show = (id) => {
        if (current === id) return;
        if (current) watchers.get(current)?.stop();
        current = id;
        watchers.get(id)?.start();
      };
      const observer = new IntersectionObserver((entries) => {
        for (const e of entries) if (e.isIntersecting && e.intersectionRatio >= 0.6) show(e.target.dataset.id);
      }, { root: feed, threshold: [0.6] });

      const build = (focusId) => {
        for (const w of watchers.values()) w.stop();
        watchers.clear();
        current = null;
        observer.disconnect();
        const shown = orderSessions(sessions, { level: myLevel(), only });
        feed.innerHTML = shown.length ? shown.map(slideHtml).join("") : `<div class="lv-slide lv-none"><p>${t("live.noneAtLevel")}</p></div>`;
        feed.querySelectorAll(".lv-slide[data-id]").forEach((slide) => {
          const s = shown.find((x) => x.id === slide.dataset.id);
          watchers.set(s.id, watcher(slide, s));
          observer.observe(slide);
        });
        panel.querySelector("#lv-swipe").hidden = shown.length < 2;
        const at = feed.querySelector(`.lv-slide[data-id="${CSS.escape(focusId ?? "")}"]`);
        if (at) feed.scrollTop = at.offsetTop;
      };

      // new streams join at the end, so the one you're watching doesn't jump
      const addNew = async () => {
        const out = await api({ op: "live" });
        if (!out.ok || !panel.isConnected) return;
        const fresh = out.sessions.filter((s) => s.id !== out.mine && !sessions.some((x) => x.id === s.id));
        if (!fresh.length) return;
        sessions = [...sessions, ...fresh];
        for (const s of orderSessions(fresh, { only })) {
          feed.querySelector(".lv-none")?.remove();
          feed.insertAdjacentHTML("beforeend", slideHtml(s));
          const slide = feed.lastElementChild;
          watchers.set(s.id, watcher(slide, s));
          observer.observe(slide);
        }
        panel.querySelector("#lv-swipe").hidden = feed.querySelectorAll(".lv-slide[data-id]").length < 2;
      };

      panel.querySelectorAll("[data-only]").forEach((b) => b.addEventListener("click", () => {
        only = b.dataset.only || null;
        panel.querySelectorAll("[data-only]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
        build(current);
      }));
      feed.addEventListener("scroll", () => { panel.querySelector("#lv-swipe").hidden = true; }, { once: true, passive: true });
      panel.querySelector("#lv-close").addEventListener("click", close);

      build(startId);
      keepAwake().then((l) => { lock = l; });
      refresh = setInterval(addNew, FEED_REFRESH_MS);
    },
    onClosed: () => {
      clearInterval(refresh);
      for (const w of watchers.values()) w.stop();
      lock?.release?.().catch?.(() => {});
    },
  });
}
