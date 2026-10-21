// ingredient-board.js — a shared mealtime without photos, drawn from its foods: one tile each, a
// glyph for the kind of food, its name and weight. Made on the phone from the analysed foods, so
// it costs nothing, works offline and is there the moment the post is. (Photos, when there are
// any, become a collage instead: social.collagePhotos.)

import { foodIconSvg, categoryOfName } from "./food-icons.js";
import { formatNumber } from "../i18n.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Tiles for up to `limit` foods (the last tile says how many more); "" when there are none. */
export function ingredientBoardHtml(items, { limit = 6 } = {}) {
  const list = (items ?? []).filter((i) => String(i?.name ?? "").trim());
  if (list.length === 0) return "";
  const many = list.length > limit;
  const shown = many ? list.slice(0, limit - 1) : list;
  const total = shown.length + (many ? 1 : 0);
  const cols = total <= 2 || total === 4 ? 2 : 3;
  const tiles = shown.map((i) => {
    const grams = Math.round(Number(i.gramsEstimate) || 0);
    return `<li class="ib-tile"><span class="ib-glyph">${foodIconSvg(categoryOfName(i.name) ?? "plate", { size: 30 })}</span><b>${esc(i.name)}</b><small>${grams > 0 ? `${formatNumber(grams)} g` : `${formatNumber(Math.round(Number(i.calories) || 0))} kcal`}</small></li>`;
  });
  if (many) tiles.push(`<li class="ib-tile ib-more"><b>+${list.length - shown.length}</b></li>`);
  // the last tile fills out an unfinished row, so the board never has a hole in it
  const rest = total % cols;
  if (rest) tiles[tiles.length - 1] = tiles[tiles.length - 1].replace("<li ", `<li style="grid-column: span ${cols - rest + 1}" `);
  return `<ul class="ib" data-cols="${cols}">${tiles.join("")}</ul>`;
}
