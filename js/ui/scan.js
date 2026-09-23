// scan.js — unified camera capture (CameraScanView.swift), SPEC-UI.md §11.
// Full-screen cover: live getUserMedia preview, 3-way mode switcher (Scan Food / Barcode /
// Food label), corner-bracket viewfinder (visual guide ONLY — barcode detection reads the
// ENTIRE camera frame, per the §11.2 bug-fix note), torch, photo-library picker, manual
// barcode entry fallback. Barcode decoding: native BarcodeDetector when available, else the
// vendored zbar-wasm polyfill (no runtime CDN dependency).

import { resizeImage, scanPreset } from "../resize.js";
import { t } from "../i18n.js";
import * as store from "../store.js";

const escapeAttr = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
import { icon } from "./icons.js";
import { openFullScreenCover } from "./sheet.js";

const MODES = [
  { id: "food", title: "Scan Food", icon: "viewfinderRectangular" },
  { id: "barcode", title: "Barcode", icon: "barcode" },
  { id: "label", title: "Food label", icon: "listBulletRectanglePortrait" },
];

const BARCODE_FORMATS_NATIVE = ["ean_13", "ean_8", "upc_a", "upc_e"];
const BARCODE_FORMATS_POLYFILL = ["ean_13", "ean_8", "upc_a", "upc_e"];
const BARCODE_POLL_MS = 300;

let DetectorClassPromise = null;

/** Resolves a BarcodeDetector-compatible class: native if it supports our formats, else vendored polyfill. */
function getDetectorClass() {
  if (!DetectorClassPromise) {
    DetectorClassPromise = (async () => {
      if (typeof globalThis.BarcodeDetector !== "undefined") {
        try {
          const supported = await globalThis.BarcodeDetector.getSupportedFormats();
          if (BARCODE_FORMATS_NATIVE.some((f) => supported.includes(f))) {
            return { Cls: globalThis.BarcodeDetector, formats: BARCODE_FORMATS_NATIVE.filter((f) => supported.includes(f)) };
          }
        } catch {
          // fall through to polyfill
        }
      }
      const mod = await import("../../vendor/barcode-detector-polyfill.js");
      return { Cls: mod.BarcodeDetectorPolyfill, formats: BARCODE_FORMATS_POLYFILL };
    })();
  }
  return DetectorClassPromise;
}

/**
 * Opens the camera scan full-screen cover.
 * @param {{onResult:(result:{type:"foodPhoto"|"labelPhoto", dataUrl:string}|{type:"barcode", code:string})=>void}} opts
 */
let noteText = ""; // survives the camera panel re-rendering (torch toggle, permission changes)

export function openCameraScan({ onResult }) {
  let mode = "food";
  let cameraState = "checking"; // checking | ready | denied | noCamera
  let stream = null;
  let torchOn = false;
  let torchSupported = false;
  let didDeliver = false;
  let barcodeTimer = null;
  let detector = null;
  let closed = false;

  openFullScreenCover({
    onClosed: () => {
      closed = true;
      stopBarcodeLoop();
      stopStream();
    },
    render(panel, close) {
      const deliver = (result) => {
        if (didDeliver) return;
        didDeliver = true;
        if (result.type === "barcode" && typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
          navigator.vibrate([15, 30, 15]); // success-notification haptic stand-in
        }
        close();
        onResult(result);
      };

      const renderScreen = () => {
        panel.innerHTML = `
          <div class="scan-screen">
            <video class="scan-video ${cameraState === "ready" ? "" : "hidden"}" id="scan-video" autoplay playsinline muted></video>
            <div class="scan-topbar">
              <button class="scan-close-btn" id="scan-close">${icon("xmark", { size: 18 })}</button>
            </div>
            <div class="scan-spacer"></div>
            ${centerHtml()}
            <div class="scan-spacer"></div>
            ${mode === "barcode" && (cameraState === "denied" || cameraState === "noCamera") ? manualBarcodeHtml() : ""}
            <div class="scan-bottom-controls">
              <div class="scan-mode-chips">
                ${MODES.map(
                  (m) => `
                  <button class="mode-chip${m.id === mode ? " selected" : ""}" data-mode="${m.id}">
                    ${icon(m.icon, { size: 16 })}<span>${m.title}</span>
                  </button>`
                ).join("")}
              </div>
              ${mode === "meal" ? `
                <div class="scan-note-row">
                  <input type="text" id="scan-note" class="scan-note" placeholder="${t("context.before")}" value="${escapeAttr(noteText)}" />
                </div>` : ""}
              <div class="shutter-row">
                <button class="shutter-side-btn" id="scan-flash" ${torchSupported ? "" : "disabled"}>
                  ${icon(torchOn ? "boltFill" : "boltSlashFill", { size: 18 })}
                </button>
                <button class="shutter-btn" id="scan-shutter" ${mode === "barcode" || cameraState !== "ready" ? "disabled" : ""}>
                  <div class="shutter-btn-inner"></div>
                </button>
                <button class="shutter-side-btn" id="scan-library">${icon("photoOnRectangle", { size: 18 })}</button>
                <input type="file" accept="image/*" id="scan-file-input" class="hidden" />
              </div>
            </div>
          </div>
        `;
        wireScreen();
      };

      const centerHtml = () => {
        if (cameraState === "checking") {
          return `<div class="scan-checking"><div class="spinner"></div></div>`;
        }
        if (cameraState === "ready") {
          // Square guide, side = min(w,h) x 0.82 of the 280pt-tall geometry box.
          const side = Math.round(Math.min(window.innerWidth - 40, 280) * 0.82);
          return `
            <div class="scan-viewfinder-wrap">
              <div class="scan-viewfinder-frame" style="width:${side}px;height:${side}px;">
                <div class="scan-corner tl"></div><div class="scan-corner tr"></div>
                <div class="scan-corner bl"></div><div class="scan-corner br"></div>
              </div>
            </div>
          `;
        }
        const message =
          cameraState === "denied"
            ? "SnapCal needs camera access to scan food. Enable it in Settings, or choose a photo from your library below."
            : "No camera available on this device. Use the photo library below to test capture, or enter a barcode manually.";
        return `
          <div class="scan-fallback">
            ${icon("cameraFill", { size: 44, color: "rgba(255,255,255,0.6)" })}
            <div class="scan-fallback-msg">${message}</div>
          </div>
        `;
      };

      const manualBarcodeHtml = () => `
        <div class="scan-manual-barcode">
          <input type="text" class="scan-manual-input" id="manual-barcode-input" inputmode="numeric" placeholder="Enter barcode digits" />
          <button class="scan-go-btn" id="manual-barcode-go" disabled>Go</button>
        </div>
      `;

      const wireScreen = () => {
        panel.querySelector("#scan-close").addEventListener("click", () => close());

        panel.querySelectorAll("[data-mode]").forEach((chip) => {
          chip.addEventListener("click", () => {
            const next = chip.dataset.mode;
            if (next === mode) return;
            mode = next;
            if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") navigator.vibrate(8);
            if (mode === "barcode" && cameraState === "ready") startBarcodeLoop();
            else stopBarcodeLoop();
            renderScreen();
          });
        });

        const flashBtn = panel.querySelector("#scan-flash");
        flashBtn.addEventListener("click", async () => {
          if (!torchSupported || !stream) return;
          torchOn = !torchOn;
          const track = stream.getVideoTracks()[0];
          try {
            await track.applyConstraints({ advanced: [{ torch: torchOn }] });
          } catch {
            torchOn = false;
          }
          renderScreen();
        });

        const shutterBtn = panel.querySelector("#scan-shutter");
        shutterBtn.addEventListener("click", async () => {
          if (mode === "barcode" || cameraState !== "ready") return;
          const video = panel.querySelector("#scan-video");
          if (!video || !video.videoWidth) return;
          const canvas = document.createElement("canvas");
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          canvas.getContext("2d").drawImage(video, 0, 0);
          const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
          if (!blob) return;
          const { dataUrl } = await resizeImage(blob, scanPreset(store.getProfile().scanQuality));
          deliver({ type: mode === "label" ? "labelPhoto" : "foodPhoto", dataUrl, note: noteText.trim() || null });
        });

        panel.querySelector("#scan-note")?.addEventListener("input", (e) => { noteText = e.target.value; });

        const fileInput = panel.querySelector("#scan-file-input");
        panel.querySelector("#scan-library").addEventListener("click", () => fileInput.click());
        fileInput.addEventListener("change", async () => {
          const file = fileInput.files && fileInput.files[0];
          if (!file) return;
          if (mode === "barcode") {
            // Route like a live capture: try to decode a barcode from the picked image.
            try {
              const { Cls, formats } = await getDetectorClass();
              const det = new Cls({ formats });
              const bitmap = await createImageBitmap(file);
              const results = await det.detect(bitmap);
              if (results.length > 0) {
                deliver({ type: "barcode", code: results[0].rawValue });
                return;
              }
            } catch {
              // fall through — nothing decoded
            }
            return;
          }
          const { dataUrl } = await resizeImage(file, scanPreset(store.getProfile().scanQuality));
          deliver({ type: mode === "label" ? "labelPhoto" : "foodPhoto", dataUrl, note: noteText.trim() || null });
        });

        const manualInput = panel.querySelector("#manual-barcode-input");
        const manualGo = panel.querySelector("#manual-barcode-go");
        if (manualInput && manualGo) {
          manualInput.addEventListener("input", () => {
            manualGo.disabled = manualInput.value.trim() === "";
          });
          manualGo.addEventListener("click", () => {
            const code = manualInput.value.trim();
            if (code !== "") deliver({ type: "barcode", code });
          });
        }

        // Re-attach the stream to the (re-created) video element.
        const video = panel.querySelector("#scan-video");
        if (video && stream) {
          video.srcObject = stream;
        }
      };

      const startCamera = async () => {
        if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
          cameraState = "noCamera";
          renderScreen();
          return;
        }
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
            audio: false,
          });
        } catch (err) {
          cameraState = err && (err.name === "NotAllowedError" || err.name === "SecurityError") ? "denied" : "noCamera";
          renderScreen();
          return;
        }
        if (closed) {
          stopStream();
          return;
        }
        cameraState = "ready";
        const track = stream.getVideoTracks()[0];
        try {
          const caps = typeof track.getCapabilities === "function" ? track.getCapabilities() : {};
          torchSupported = caps.torch === true;
        } catch {
          torchSupported = false;
        }
        renderScreen();
        if (mode === "barcode") startBarcodeLoop();
      };

      const startBarcodeLoop = async () => {
        stopBarcodeLoop();
        if (!detector) {
          try {
            const { Cls, formats } = await getDetectorClass();
            detector = new Cls({ formats });
          } catch (err) {
            console.warn("scan.js: no barcode detector available", err);
            return;
          }
        }
        barcodeTimer = setInterval(async () => {
          if (didDeliver || mode !== "barcode") return;
          const video = panel.querySelector("#scan-video");
          if (!video || video.readyState < 2 || !video.videoWidth) return;
          try {
            // FULL camera frame, not just the viewfinder brackets (§11.2 bug-fix note).
            const results = await detector.detect(video);
            if (results.length > 0 && results[0].rawValue) {
              deliver({ type: "barcode", code: results[0].rawValue });
            }
          } catch {
            // per-frame decode errors are non-fatal
          }
        }, BARCODE_POLL_MS);
      };

      renderScreen();
      startCamera();
    },
  });

  // --- teardown helpers (function-scope so both render() and onClosed can reach them) -----
  function stopStream() {
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
  }
  function stopBarcodeLoop() {
    if (barcodeTimer) {
      clearInterval(barcodeTimer);
      barcodeTimer = null;
    }
  }
}
