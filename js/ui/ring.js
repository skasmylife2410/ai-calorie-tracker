// ring.js — RingGauge component (SPEC-UI.md §1.3): two concentric circles, progress arc starts
// at 12 o'clock and draws clockwise, round line caps, .easeOut transition on progress change.

/**
 * Returns markup for a ring gauge. Caller wraps it in a positioned container if a center icon
 * is supplied (already baked in here via .ring-center).
 * @param {{size:number, strokeWidth:number, progress:number, color:string, trackColor:string, centerHtml?:string}} opts
 */
let maskSeq = 0;

export function ringGauge({ size, strokeWidth, progress, color, trackColor, centerHtml = "" }) {
  const radius = size / 2 - strokeWidth / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(1, progress));
  const dashOffset = circumference * (1 - clamped);
  // The Mono theme draws big rings as a ring of dots (css/mono.css shows .ring-dots and hides the
  // solid arcs): a dotted track, and the same dots in colour masked to the progress arc.
  const dotted = size >= 60 ? dottedLayers({ size, strokeWidth, radius, circumference, dashOffset, color, trackColor }) : "";
  return `
    <div class="ring-wrap" style="width:${size}px;height:${size}px;">
      <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
        <circle class="ring-track" cx="${size / 2}" cy="${size / 2}" r="${radius}" stroke="${trackColor}" stroke-width="${strokeWidth}"></circle>
        <circle class="ring-progress" cx="${size / 2}" cy="${size / 2}" r="${radius}" stroke="${color}" stroke-width="${strokeWidth}"
          stroke-dasharray="${circumference}" stroke-dashoffset="${dashOffset}"></circle>
        ${dotted}
      </svg>
      <div class="ring-center">${centerHtml}</div>
    </div>
  `;
}

function dottedLayers({ size, strokeWidth, radius, circumference, dashOffset, color, trackColor }) {
  const id = `ring-dots-${++maskSeq}`;
  const dot = Math.max(3, strokeWidth * 0.55);
  const count = Math.max(12, Math.round(circumference / (dot * 2.1)));
  const pitch = circumference / count;
  const c = size / 2;
  return `
        <mask id="${id}"><circle class="ring-dots-mask" cx="${c}" cy="${c}" r="${radius}" stroke="#fff" stroke-width="${strokeWidth * 1.4}" fill="none"
          stroke-dasharray="${circumference}" stroke-dashoffset="${dashOffset}"></circle></mask>
        <g class="ring-dots">
          <circle cx="${c}" cy="${c}" r="${radius}" stroke="${trackColor}" stroke-width="${dot}" stroke-dasharray="0.01 ${pitch - 0.01}"></circle>
          <circle cx="${c}" cy="${c}" r="${radius}" stroke="${color}" stroke-width="${dot * 1.25}" stroke-dasharray="0.01 ${pitch - 0.01}" mask="url(#${id})"></circle>
        </g>`;
}
