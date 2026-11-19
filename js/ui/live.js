// live.js — "Train together" on the Us tab: go live for your group while you work out; the others
// can watch, or join with their own camera and train with you.
//
// The video goes straight between phones (WebRTC). The server (api/_live.js via /api/groups) only
// says who is live and passes each viewer's connection offer and the answer, once. The person
// who's live sends one copy of their video to each viewer, so a session holds a few people at
// most (MAX_WATCHING on the server, ten). Nothing is recorded.

import { t } from "../i18n.js";
import { apiFetch } from "../net.js";
import { icon } from "./icons.js";
import { openSheet, openFullScreenCover, navBar, wireNavBar } from "./sheet.js";

export const MUSCLES = ["chest", "back", "legs", "shoulders", "arms", "core", "full", "cardio"];
export const LEVELS = ["beginner", "average", "expert"];
const BEAT_MS = 2500;      // the live phone asks for new viewers this often
const VIEW_BEAT_MS = 5000; // a viewer says "still here" this often
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

/** Sessions doing the same workout come first, then the newest. */
export function orderSessions(sessions, mine = null) {
  const list = [...(sessions ?? [])];
  if (!mine) return list;
  return list.sort((a, b) => Number(b.muscle === mine) - Number(a.muscle === mine));
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
    video: { facingMode: facing, width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24, max: 30 } },
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

let pendingLive = null; // a notification asked to open this session
let lastIce = FALLBACK_ICE;

/** A "X is live" notification was tapped: open that session once the Us card has loaded. */
export function wantLive(id) { pendingLive = id || null; }

export function renderLiveCard(el, { group } = {}) {
  if (!el || !group?.id) return;
  let timer = null;
  const draw = async () => {
    if (!el.isConnected) { clearInterval(timer); return; }
    if (document.visibilityState === "hidden") return;
    const out = await api({ op: "live", group: group.id });
    if (!el.isConnected || !out.ok) return;
    lastIce = out.ice?.length ? out.ice : FALLBACK_ICE;
    const others = orderSessions(out.sessions.filter((s) => s.id !== out.mine));
    const mineLive = out.sessions.find((s) => s.id === out.mine);
    el.innerHTML = `
      <div class="lv-card card">
        <div class="lv-head">
          <span class="lv-head-ic" aria-hidden="true">${icon("dumbbell", { size: 16 })}</span>
          <b>${t("live.title")}</b>
        </div>
        ${others.length ? others.map((s) => `
          <div class="lv-row">
            <div class="lv-who">
              <b><i class="lv-dot" aria-hidden="true"></i>${esc(s.name)}</b>
              <span>${esc(workoutLabel(s.muscle, s.level))}${s.watching ? ` · ${t("live.watching", { n: s.watching })}` : ""}</span>
            </div>
            <button type="button" class="lv-btn" data-lv-watch="${esc(s.id)}">${t("live.watch")}</button>
            <button type="button" class="lv-btn is-ink" data-lv-join="${esc(s.id)}">${t("live.join")}</button>
          </div>`).join("") : `<p class="lv-empty">${t("live.empty")}</p>`}
        ${mineLive ? "" : `<button type="button" class="lv-go" data-lv-go>${icon("cameraFill", { size: 15 })}<span>${t("live.goLive")}</span></button>`}
      </div>`;
    el.querySelector("[data-lv-go]")?.addEventListener("click", () => openGoLive({ group }));
    const find = (id) => others.find((s) => s.id === id);
    el.querySelectorAll("[data-lv-watch]").forEach((b) => b.addEventListener("click", () => openWatch(find(b.dataset.lvWatch), { camera: false })));
    el.querySelectorAll("[data-lv-join]").forEach((b) => b.addEventListener("click", () => openWatch(find(b.dataset.lvJoin), { camera: true })));
    if (pendingLive) {
      const s = find(pendingLive);
      pendingLive = null;
      if (s) openWatch(s, { camera: false });
    }
  };
  draw();
  timer = setInterval(draw, CARD_REFRESH_MS);
}

// --- going live ----------------------------------------------------------------------------

function openGoLive({ group }) {
  let muscle = null;
  let level = null;
  try { level = localStorage.getItem("snapcal.liveLevel") || null; } catch { /* private mode */ }
  if (!LEVELS.includes(level)) level = null;
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
  const peers = new Map(); // signal id -> { pc, name, camera }

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
        <div class="lv-tiles" id="lv-tiles"></div>
        <div class="lv-controls">
          <button type="button" class="lv-ctl" id="lv-mic" aria-pressed="false" aria-label="${t("live.mic")}">${icon("mic", { size: 20 })}</button>
          <button type="button" class="lv-ctl" id="lv-flip" aria-label="${t("live.flip")}">${icon("cameraFill", { size: 20 })}</button>
          <button type="button" class="lv-end" id="lv-end">${t("live.end")}</button>
        </div>`;
      const $ = (id) => panel.querySelector(`#${id}`);
      const status = (key) => { $("lv-status").textContent = key ? t(key) : ""; $("lv-status").hidden = !key; };

      const finish = async () => {
        if (ended) return;
        ended = true;
        for (const p of peers.values()) p.pc.close();
        stream?.getTracks().forEach((tr) => tr.stop());
        lock?.release?.().catch?.(() => {});
        if (sessionId) await api({ op: "liveEnd", id: sessionId });
        close();
      };
      $("lv-end").addEventListener("click", finish);

      const setMic = () => {
        stream?.getAudioTracks().forEach((tr) => { tr.enabled = micOn; });
        $("lv-mic").setAttribute("aria-pressed", String(micOn));
        $("lv-mic").classList.toggle("is-off", !micOn);
      };
      $("lv-mic").addEventListener("click", () => { micOn = !micOn; setMic(); });
      $("lv-flip").addEventListener("click", async () => {
        try {
          facing = facing === "user" ? "environment" : "user";
          const fresh = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 640 }, height: { ideal: 480 } } });
          const track = fresh.getVideoTracks()[0];
          const old = stream.getVideoTracks()[0];
          for (const p of peers.values()) p.pc.getSenders().find((s) => s.track?.kind === "video")?.replaceTrack(track);
          stream.removeTrack(old); old.stop(); stream.addTrack(track);
          $("lv-self").classList.toggle("is-mirror", facing === "user");
        } catch { /* keep the camera it had */ }
      });

      const addTile = (sig, name, remote) => {
        let tile = panel.querySelector(`[data-tile="${sig}"]`);
        if (!tile) {
          tile = document.createElement("div");
          tile.className = "lv-tile";
          tile.dataset.tile = sig;
          tile.innerHTML = `<video autoplay playsinline></video><span>${esc(name)}</span>`;
          $("lv-tiles").appendChild(tile);
        }
        tile.querySelector("video").srcObject = remote;
      };
      const drop = (sig) => {
        peers.get(sig)?.pc.close();
        peers.delete(sig);
        panel.querySelector(`[data-tile="${sig}"]`)?.remove();
      };

      const answer = async (o) => {
        const pc = new RTCPeerConnection({ iceServers: lastIce });
        peers.set(o.id, { pc, name: o.name, camera: o.camera });
        stream.getTracks().forEach((tr) => pc.addTrack(tr, stream));
        pc.addEventListener("track", (e) => { if (o.camera && e.track.kind === "video") addTile(o.id, o.name, e.streams[0] ?? new MediaStream([e.track])); });
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
      // the phone woke the screen lock again after coming back
      document.addEventListener("visibilitychange", async () => { if (!ended && document.visibilityState === "visible") lock = await keepAwake(); });
    },
    onClosed: () => { if (!ended) { ended = true; stream?.getTracks().forEach((tr) => tr.stop()); for (const p of peers.values()) p.pc.close(); if (sessionId) api({ op: "liveEnd", id: sessionId }); } },
  });
}

// --- watching / joining --------------------------------------------------------------------

function openWatch(s, { camera: withCamera }) {
  if (!s) return;
  let pc = null;
  let mine = null;
  let signal = null;
  let left = false;
  let lock = null;

  openFullScreenCover({
    render: (panel, close) => {
      panel.classList.add("lv-cover");
      panel.innerHTML = `
        <video class="lv-main" id="lv-them" autoplay playsinline></video>
        <div class="lv-top">
          <span class="lv-badge"><i class="lv-dot" aria-hidden="true"></i>${t("live.badge")}</span>
          <span class="lv-what"><b>${esc(s.name)}</b> · ${esc(workoutLabel(s.muscle, s.level))}</span>
        </div>
        <div class="lv-status" id="lv-status">${t("live.connecting")}</div>
        <div class="lv-tiles">${withCamera ? `<div class="lv-tile"><video id="lv-me" class="is-mirror" autoplay playsinline muted></video><span>${t("live.you")}</span></div>` : ""}</div>
        <div class="lv-controls">
          <button type="button" class="lv-ctl" id="lv-sound" hidden>${t("live.sound")}</button>
          <button type="button" class="lv-end" id="lv-leave">${t("live.leave")}</button>
        </div>`;
      const $ = (id) => panel.querySelector(`#${id}`);
      const status = (key) => { $("lv-status").textContent = key ? t(key) : ""; $("lv-status").hidden = !key; };

      const leave = () => {
        if (left) return;
        left = true;
        pc?.close();
        mine?.getTracks().forEach((tr) => tr.stop());
        lock?.release?.().catch?.(() => {});
        if (signal) api({ op: "liveLeave", signal });
        close();
      };
      $("lv-leave").addEventListener("click", leave);
      $("lv-sound").addEventListener("click", () => { $("lv-them").muted = false; $("lv-them").play().catch(() => {}); $("lv-sound").hidden = true; });

      (async () => {
        pc = new RTCPeerConnection({ iceServers: lastIce });
        if (withCamera) {
          try {
            mine = await camera("user");
            $("lv-me").srcObject = mine;
            mine.getTracks().forEach((tr) => pc.addTrack(tr, mine));
          } catch {
            status("live.noCamera");
            return;
          }
        } else {
          pc.addTransceiver("video", { direction: "recvonly" });
          pc.addTransceiver("audio", { direction: "recvonly" });
        }
        pc.addEventListener("track", (e) => {
          const v = $("lv-them");
          if (!v) return;
          v.srcObject = e.streams[0] ?? new MediaStream([e.track]);
          v.play().catch(() => { v.muted = true; v.play().catch(() => {}); $("lv-sound").hidden = false; });
          status("");
        });
        pc.addEventListener("connectionstatechange", () => {
          if (pc.connectionState === "failed") status("live.blocked");
          if (pc.connectionState === "disconnected") status("live.reconnecting");
          if (pc.connectionState === "connected") status("");
        });
        await pc.setLocalDescription(await pc.createOffer());
        await iceDone(pc);
        if (left) return;
        const join = await api({ op: "liveJoin", id: s.id, offer: pc.localDescription.sdp, camera: withCamera });
        if (!join.ok) { status(join.errorType === "ended" ? "live.over" : join.errorType === "full" ? "live.full" : join.errorType === "network" ? "live.offline" : "live.failed"); return; }
        signal = join.signal;
        lock = await keepAwake();
        const until = Date.now() + ANSWER_WAIT_MS;
        let answered = false;
        while (!left) {
          const w = await api({ op: "liveWait", signal });
          if (left) break;
          if (w.ok && w.ended) { status("live.over"); pc.close(); break; }
          if (w.ok && w.answer && !answered) {
            answered = true;
            await pc.setRemoteDescription({ type: "answer", sdp: w.answer });
          }
          if (!answered && Date.now() > until) { status("live.blocked"); break; }
          await sleep(answered ? VIEW_BEAT_MS : 1000);
        }
      })().catch(() => status("live.failed"));
    },
    onClosed: () => { if (!left) { left = true; pc?.close(); mine?.getTracks().forEach((tr) => tr.stop()); if (signal) api({ op: "liveLeave", signal }); } },
  });
}
