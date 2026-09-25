// icons.js — inline SVG stand-ins for every SF Symbol used in SPEC-UI.md §14.
// Not vector-identical to SF Symbols (no license to redistribute Apple's glyphs), but visually
// faithful in silhouette/line-weight so the clone reads the same at a glance. All icons share a
// 24x24 viewBox and use currentColor so callers control size/color/weight via CSS + wrapper size.

const RAW = {
  // --- filled glyphs -------------------------------------------------------
  // three stacked layers: a meal made of several foods grouped together
  layersFill: `<path d="M12 2.4 2.9 7.05a.62.62 0 0 0 0 1.1L12 12.8l9.1-4.65a.62.62 0 0 0 0-1.1L12 2.4Z"/><path opacity=".72" d="m5.2 10.9-2.3 1.17a.62.62 0 0 0 0 1.1L12 17.8l9.1-4.63a.62.62 0 0 0 0-1.1l-2.3-1.17L12 14.37 5.2 10.9Z"/><path opacity=".45" d="m5.2 15.9-2.3 1.17a.62.62 0 0 0 0 1.1L12 22.8l9.1-4.63a.62.62 0 0 0 0-1.1l-2.3-1.17L12 19.37 5.2 15.9Z"/>`,
  forkKnife: `<path d="M6.5 2c-.28 0-.5.22-.5.5v6.6c0 1.1.68 2.04 1.65 2.4L7.4 21c-.03.55.4 1 .95 1h.3c.55 0 .98-.45.95-1l-.25-9.5c.97-.36 1.65-1.3 1.65-2.4V2.5a.5.5 0 0 0-1 0v5.6c0 .5-.3.94-.75 1.12V2.5a.5.5 0 0 0-1 0v6.72A1.22 1.22 0 0 1 7 8.1V2.5a.5.5 0 0 0-.5-.5Z"/><path d="M16.8 2.03c-1.9.32-3.3 2.7-3.3 5.6 0 2.2 1 4.02 2.4 4.7L15.4 21c-.03.55.4 1 .95 1h.3c.55 0 .98-.45.95-1l-.5-8.66c1.4-.68 2.4-2.5 2.4-4.7 0-3.2-1.6-5.7-3.75-5.6Z"/>`,
  flameFill: `<path d="M13.5 1.2s.74 2.65.74 4.8c0 2.06-1.35 3.73-3.41 3.73-2.07 0-3.63-1.67-3.63-3.73l.03-.36C5.21 7.7 4 10.62 4 13.75 4 18.17 7.58 21.75 12 21.75s8-3.58 8-8c0-5.39-2.59-10.2-6.5-12.55ZM11.71 18.75c-1.78 0-3.22-1.4-3.22-3.14 0-1.62 1.05-2.76 2.81-3.12 1.77-.36 3.6-1.21 4.62-2.58.39 1.29.59 2.65.59 4.04 0 2.65-2.15 4.8-4.8 4.8Z"/>`,
  fishFill: `<path d="M3 12c2.5-3.5 6-5.5 9.5-5.5 3 0 5.7 1.4 7.8 3.6.4.4.9.4 1.2-.1.5-.8.8-1.6 1-2.3.1-.4.6-.4.7 0 .3 1.1.5 2.6.3 4.3-.2 1.7-.4 3.2-.7 4.3-.1.4-.6.4-.7 0-.2-.7-.5-1.5-1-2.3-.3-.5-.8-.5-1.2-.1-2.1 2.2-4.8 3.6-7.8 3.6C9 17.5 5.5 15.5 3 12Z"/><circle cx="7.4" cy="10.6" r="0.9"/>`,
  leafFill: `<path d="M20 4c-8.5 0-15 5.8-15 13.5 0 .8.66 1.4 1.44 1.28C7.9 18.2 9.4 16.4 11 14.7c1.9-2 4.3-3.9 7.4-5.3.4-.2.8.3.5.6-2.6 2.6-4.6 5-6 7.4-.2.4.2.9.6.7 6.6-3 9.5-8.5 9.5-13.1 0-.6-.5-1-1-1Z"/>`,
  dropFill: `<path d="M12 2.4c-3 3.9-6.5 8.6-6.5 12.3 0 3.6 2.9 6.8 6.5 6.8s6.5-3.2 6.5-6.8c0-3.7-3.5-8.4-6.5-12.3Z"/>`,
  bookmarkFill: `<path d="M6.5 3A1.5 1.5 0 0 0 5 4.5v16l7-4.5 7 4.5v-16A1.5 1.5 0 0 0 17.5 3h-11Z"/>`,
  bookmark: `<path d="M6.5 3A1.5 1.5 0 0 0 5 4.5v16l7-4.5 7 4.5v-16A1.5 1.5 0 0 0 17.5 3h-11Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>`,
  scale: `<path d="M12 3.2a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2Z"/><path d="M5.4 7.6h13.2a1 1 0 0 1 .98 1.2l-1.8 9.4a1.6 1.6 0 0 1-1.57 1.3H7.79a1.6 1.6 0 0 1-1.57-1.3l-1.8-9.4a1 1 0 0 1 .98-1.2Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M9.4 11.2 12 14.4l2.6-3.2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>`,
  mic: `<path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z"/><path d="M6.5 11.5a5.5 5.5 0 0 0 11 0M12 17v3.5M9 20.5h6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>`,
  houseFill: `<path d="M12 2.6 2.5 10.8c-.4.35-.15 1 .35 1h1.65v8.6c0 .55.45 1 1 1H9v-6.4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v6.4h3.5c.55 0 1-.45 1-1v-8.6h1.65c.5 0 .75-.65.35-1L12 2.6Z"/>`,
  chartBarFill: `<rect x="4" y="12" width="4" height="9" rx="1"/><rect x="10" y="7" width="4" height="14" rx="1"/><rect x="16" y="3" width="4" height="18" rx="1"/>`,
  personFill: `<circle cx="12" cy="7" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7c0 .55-.45 1-1 1H5c-.55 0-1-.45-1-1Z"/>`,
  textBubbleFill: `<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8A2.5 2.5 0 0 1 17.5 16H10l-4.5 4v-4H6.5A2.5 2.5 0 0 1 4 13.5v-8Z"/>`,
  exclamationTriangleFill: `<path d="M12 3.2 22 20.5H2L12 3.2Z"/><rect x="11.1" y="9.5" width="1.8" height="5.5" rx="0.9" fill="white"/><circle cx="12" cy="17.2" r="1.05" fill="white"/>`,
  wandAndStars: `<path d="M15.5 3.5 17 5l-9 9-1.5-1.5 9-9Z"/><path d="M4 20l4-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M18.5 2.5l.5 1.5 1.5.5-1.5.5-.5 1.5-.5-1.5-1.5-.5 1.5-.5Z"/><path d="M4.5 8.5l.4 1.2 1.2.4-1.2.4-.4 1.2-.4-1.2-1.2-.4 1.2-.4Z"/><path d="M20.5 14.5l.4 1.2 1.2.4-1.2.4-.4 1.2-.4-1.2-1.2-.4 1.2-.4Z"/>`,
  boltFill: `<path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z"/>`,
  boltSlashFill: `<path d="M13 2 6.6 10.7l1.4 1.4L13 6l-.7 5.7 1.6 1.6L19 14h-6l1-8-1 .3.6-4.3Z"/><path d="M3 3l18 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M9.5 14.3 8.5 22l6-8h-4l-1 .3Z"/>`,
  trashFill: `<path d="M9 3.5c0-.28.22-.5.5-.5h5c.28 0 .5.22.5.5V4h4a1 1 0 0 1 0 2h-.6l-1 13.6A2 2 0 0 1 15.4 21H8.6a2 2 0 0 1-2-1.9L5.6 6H5a1 1 0 1 1 0-2h4v-.5Z"/>`,
  cameraFill: `<path d="M9 4a1 1 0 0 0-.86.5L7.3 6H4.5A1.5 1.5 0 0 0 3 7.5v11A1.5 1.5 0 0 0 4.5 20h15a1.5 1.5 0 0 0 1.5-1.5v-11A1.5 1.5 0 0 0 19.5 6h-2.8l-.84-1.5a1 1 0 0 0-.86-.5H9Z"/><circle cx="12" cy="13" r="3.4" fill="#000" style="mix-blend-mode:normal"/>`,
  xmarkCircleFill: `<circle cx="12" cy="12" r="9.5"/><path d="M9 9l6 6M15 9l-6 6" stroke="white" stroke-width="1.6" stroke-linecap="round"/>`,

  // --- stroke / outline glyphs ---------------------------------------------
  magnifyingglass: `<circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="2"/><line x1="15.3" y1="15.3" x2="21" y2="21" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`,
  cameraViewfinder: `<path d="M3 8V5.5A1.5 1.5 0 0 1 4.5 4H8M16 4h3.5A1.5 1.5 0 0 1 21 5.5V8M21 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H4.5A1.5 1.5 0 0 1 3 18.5V16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="1.9"/>`,
  plus: `<line x1="12" y1="4" x2="12" y2="20" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><line x1="4" y1="12" x2="20" y2="12" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>`,
  minus: `<line x1="4" y1="12" x2="20" y2="12" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>`,
  xmark: `<line x1="6" y1="6" x2="18" y2="18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><line x1="18" y1="6" x2="6" y2="18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>`,
  bell: `<path d="M12 2.5c-.6 0-1 .45-1 1v.6C8 4.7 6 7.1 6 10v4l-1.6 2.6c-.3.5.05 1.1.65 1.1h14c.6 0 .95-.6.65-1.1L18 14v-4c0-2.9-2-5.3-5-5.9v-.6c0-.55-.45-1-1-1Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M9.5 19.5a2.5 2.5 0 0 0 5 0" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>`,
  chevronRight: `<path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
  chevronDown: `<path d="M5 9l7 7 7-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
  questionmarkCircle: `<circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M9.6 9.3a2.4 2.4 0 1 1 3.5 2.1c-.7.4-1.1.8-1.1 1.6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="12" cy="16.6" r="1" />`,
  wifiSlash: `<path d="M2 8.5c2.7-2.3 6.2-3.6 10-3.6M22 8.5a15.9 15.9 0 0 0-4-2.6M5.3 12.3a11 11 0 0 1 6.7-2.3c1 0 2 .13 2.9.38M8.6 16a6 6 0 0 1 6.8-.1M12 20h.01" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><line x1="2.5" y1="2.5" x2="21.5" y2="21.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>`,
  viewfinderRectangular: `<path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/><rect x="8.3" y="8.3" width="7.4" height="7.4" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.6"/>`,
  barcode: `<g stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><line x1="4" y1="4" x2="4" y2="20"/><line x1="7.2" y1="4" x2="7.2" y2="20"/><line x1="10" y1="4" x2="10" y2="20" stroke-width="2.4"/><line x1="13" y1="4" x2="13" y2="20"/><line x1="15.6" y1="4" x2="15.6" y2="20" stroke-width="2.4"/><line x1="18.4" y1="4" x2="18.4" y2="20"/><line x1="20.8" y1="4" x2="20.8" y2="20"/></g>`,
  listBulletRectanglePortrait: `<rect x="4" y="2.5" width="16" height="19" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="8" cy="8" r="1"/><line x1="10.5" y1="8" x2="17" y2="8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="8" cy="12.5" r="1"/><line x1="10.5" y1="12.5" x2="17" y2="12.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="8" cy="17" r="1"/><line x1="10.5" y1="17" x2="17" y2="17" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`,
  photoOnRectangle: `<rect x="2.5" y="5.5" width="14" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M4 15.5l3.3-3.6a1 1 0 0 1 1.5.02L11 14.3l1.8-2a1 1 0 0 1 1.5 0l2.2 2.4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="6.3" cy="9" r="1.1"/><rect x="7.5" y="2.5" width="14" height="12" rx="2" fill="var(--sc-card-bg,#fff)" stroke="currentColor" stroke-width="1.6"/>`,
};

/**
 * Returns a full <svg>...</svg> markup string for `name`, sized to `size` px, using `color`
 * (default currentColor so CSS `color` on the wrapper controls it).
 */
export function iconSvg(name, { size = 24, color = "currentColor" } = {}) {
  const body = RAW[name];
  if (!body) {
    console.warn(`icons.js: unknown icon "${name}"`);
    return "";
  }
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="${color}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">${body}</svg>`;
}

/** Convenience: returns a <span class="icon"> wrapper with the svg inlined, for easy CSS sizing/coloring. */
export function icon(name, { size = 24, color = "currentColor", className = "" } = {}) {
  return `<span class="icon${className ? ` ${className}` : ""}" style="width:${size}px;height:${size}px;color:${color};display:inline-flex;align-items:center;justify-content:center;">${iconSvg(name, { size, color })}</span>`;
}
