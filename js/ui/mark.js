// mark.js — the Boca0 mark: a round bite with one bite taken out and two front teeth, so the round
// also reads as a mouth, an O ("boca"). The same shape as the app icon and the opening screen
// (index.html .intro-flame); Figma "Boca0 · logo with teeth", option A. The bite and the teeth are
// cut out, so whatever is behind shows through. Ink-coloured: it follows the text colour.

export const MARK = {
  viewBox: "10 12 80 80",
  disc: { cx: 50, cy: 52, r: 40 },
  bites: [[82, 20, 19], [64, 9, 12], [95, 42, 12]],
  teeth: [
    "M38.3 36h10.6v13.4a3.6 3.6 0 0 1-3.6 3.6h-3.4a3.6 3.6 0 0 1-3.6-3.6Z",
    "M51.1 36h10.6v13.4a3.6 3.6 0 0 1-3.6 3.6h-3.4a3.6 3.6 0 0 1-3.6-3.6Z",
  ],
};

/** The mark's SVG insides (mask + disc), with a mask id unique on the page. */
export function markSvgInner(id, fill = "currentColor") {
  const cut = MARK.bites.map(([cx, cy, r]) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#000"/>`).join("")
    + MARK.teeth.map((d) => `<path d="${d}" fill="#000"/>`).join("");
  return `<defs><mask id="${id}"><rect x="0" y="0" width="100" height="100" fill="#fff"/>${cut}</mask></defs>`
    + `<circle cx="${MARK.disc.cx}" cy="${MARK.disc.cy}" r="${MARK.disc.r}" fill="${fill}" mask="url(#${id})"/>`;
}

let n = 0;
export function biteMark(size = 44) {
  return `<svg class="bite-mark" width="${size}" height="${size}" viewBox="${MARK.viewBox}" aria-hidden="true">${markSvgInner(`bite-${++n}`)}</svg>`;
}

/** Draws the mark on a canvas (shared pictures): the round, then the bite and teeth cut out. */
export function drawMark(ctx, x, y, size, color) {
  const c = document.createElement("canvas");
  c.width = c.height = Math.ceil(size);
  const g = c.getContext("2d");
  const k = size / 80;
  g.scale(k, k); g.translate(-10, -12);
  g.fillStyle = color;
  g.beginPath(); g.arc(MARK.disc.cx, MARK.disc.cy, MARK.disc.r, 0, Math.PI * 2); g.fill();
  g.globalCompositeOperation = "destination-out";
  for (const [cx, cy, r] of MARK.bites) { g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill(); }
  for (const d of MARK.teeth) g.fill(new Path2D(d));
  ctx.drawImage(c, x, y);
}

/** Numbered points (01, 02…) with a short title and a line each: the consent and What's new lists. */
export function numberedHtml(items) {
  return `<ol class="nrows">${items.map(([title, body], i) => `
    <li class="nrow"><b class="nrow-n">${String(i + 1).padStart(2, "0")}</b>
      <span class="nrow-t">${title}</span><span class="nrow-b">${body}</span></li>`).join("")}</ol>`;
}
