// mark.js — the Boca0 mark (a round bite with one bite taken), the same shape as the app icon and
// the opening screen (index.html .intro-flame). Ink-coloured: it follows the text colour.

let n = 0;
export function biteMark(size = 44) {
  const id = `bite-${++n}`;
  return `<svg class="bite-mark" width="${size}" height="${size}" viewBox="10 12 80 80" aria-hidden="true">
    <defs><mask id="${id}"><rect x="0" y="0" width="100" height="100" fill="#fff"/><circle cx="82" cy="20" r="19" fill="#000"/><circle cx="64" cy="9" r="12" fill="#000"/><circle cx="95" cy="42" r="12" fill="#000"/></mask></defs>
    <circle cx="50" cy="52" r="40" fill="currentColor" mask="url(#${id})"/></svg>`;
}

/** Numbered points (01, 02…) with a short title and a line each: the consent and What's new lists. */
export function numberedHtml(items) {
  return `<ol class="nrows">${items.map(([title, body], i) => `
    <li class="nrow"><b class="nrow-n">${String(i + 1).padStart(2, "0")}</b>
      <span class="nrow-t">${title}</span><span class="nrow-b">${body}</span></li>`).join("")}</ol>`;
}
