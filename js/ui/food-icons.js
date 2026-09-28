// food-icons.js — what kind of food a logged meal is, as a small glyph.
//
// Ten categories plus a fallback. A meal is sorted by keywords in its name and in the names of
// the foods inside it (English and Spanish), with no network and no AI call, so it costs nothing
// and works offline. The biggest item by calories wins when a meal mixes categories, and a
// combined plate that no single keyword explains falls back to the fork-and-knife glyph.
//
import { iconSvg } from "./icons.js";

// Glyphs follow icons.js: 24×24 viewBox, filled, currentColor, so they take the ink of whatever
// they sit in (Classic and both Mono modes alike).

export const FOOD_CATEGORIES = [
  "fruit", "veg", "meat", "fish", "egg", "dairy", "grain", "bowl", "sweet", "drink",
];

const GLYPHS = {
  // apple with a leaf
  fruit: `<path d="M12 7.2c-1.3-1-4-1.5-5.7.3-1.8 1.9-1.6 5.4-.4 8.1 1.1 2.6 2.9 5 4.6 5 .7 0 1-.4 1.5-.4s.8.4 1.5.4c1.7 0 3.5-2.4 4.6-5 1.2-2.7 1.4-6.2-.4-8.1-1.7-1.8-4.4-1.3-5.7-.3Z"/><path d="M12.3 6.6c0-1.8 1-3.3 3-3.8.2 1.9-1 3.4-3 3.8Z"/>`,
  // carrot with leaves
  veg: `<path d="M14.6 8.9 4.2 19.3c-.4.4.1 1.1.6.8l9.1-3.9c2.4-1 3.6-3.7 2.9-6.1l-2.2-1.2Z"/><path d="M15.3 8.4c-.4-1.9.1-4 1.6-4.9.6 1.2.6 2.7 0 3.9 1.1-.9 2.6-1.2 4-.8-.6 1.6-2.4 2.3-4.2 2.2l-1.4-.4Z"/>`,
  // drumstick
  meat: `<path d="M14.8 3C11.4 3 9 5.6 9 9c0 1.1.3 2 .7 2.8l-2.8 2.8a2.1 2.1 0 1 0-2.4 3.6 2.1 2.1 0 1 0 3.6-2.4l2.8-2.8c.8.4 1.7.7 2.8.7 3.4 0 6-2.4 6-5.8C19.7 5.6 17.9 3 14.8 3Z"/>`,
  // fish (same silhouette as the protein marker, so they read as family)
  fish: `<path fill-rule="evenodd" d="M3 12c2.5-3.5 6-5.5 9.5-5.5 3 0 5.7 1.6 7.5 3.8L22 8.5v7l-2-1.8c-1.8 2.2-4.5 3.8-7.5 3.8C9 17.5 5.5 15.5 3 12Zm5.2-1a1 1 0 1 0-2 0 1 1 0 0 0 2 0Z"/>`,
  // fried egg with its yolk
  egg: `<path fill-rule="evenodd" d="M12 3.5c2.6 0 3.6 2 5.4 2.6 2.2.7 3.3 2.6 2.7 4.8-.4 1.6.2 3-.6 4.7-1 2.3-3.4 3.2-5.6 3.6-1.8.3-3 1.3-5 1.3-3.1 0-5.4-2.4-5.4-5.3 0-1.8-1.5-2.8-1.5-4.8C2 7 4.6 5.4 7 5.3c1.9 0 2.5-1.8 5-1.8Zm0 5.3a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8Z"/><circle cx="12" cy="12.2" r="2.3"/>`,
  // milk carton
  dairy: `<path fill-rule="evenodd" d="M8 2h8v3l2 3v12.5c0 .8-.7 1.5-1.5 1.5h-9C6.7 22 6 21.3 6 20.5V8l2-3V2Zm1 10v5h6v-5H9Z"/>`,
  // loaf of bread
  grain: `<path fill-rule="evenodd" d="M5 9.6C3.3 9.3 2 8 2 6.6 2 4.6 4.2 3 7 3h10c2.8 0 5 1.6 5 3.6 0 1.4-1.3 2.7-3 3V19c0 1.1-.9 2-2 2H7c-1.1 0-2-.9-2-2V9.6Zm4.2 2.6-.9.9 3 3 .9-.9-3-3Zm4 0-.9.9 3 3 .9-.9-3-3Z"/>`,
  // bowl with chopsticks: rice, pasta, soup, poke, ramen
  bowl: `<path d="M3 11h18c0 4.2-3 7.6-7 8.5V21h-4v-1.5c-4-.9-7-4.3-7-8.5Z"/><path d="M14.4 2.4 21.2 8.6l-.9 1-6.8-6.2.9-1Z"/><path d="M11.9 3.1l6.3 6.5-1 .9-6.2-6.6.9-.8Z"/>`,
  // cupcake
  sweet: `<path d="M12 3c2 0 3.2 1.3 3.5 2.6C17.6 5.8 19 7.3 19 9c0 .6-.4 1-1 1H6c-.6 0-1-.4-1-1 0-1.7 1.4-3.2 3.5-3.4C8.8 4.3 10 3 12 3Z"/><path d="M6 11.5h12l-1.4 8.2c-.1.7-.8 1.3-1.5 1.3H8.9c-.7 0-1.4-.6-1.5-1.3L6 11.5Z"/>`,
  // cup with a straw
  drink: `<path d="M6 8h12l-1.3 12.2c-.1.8-.8 1.3-1.5 1.3H8.8c-.8 0-1.4-.6-1.5-1.3L6 8Z"/><path d="M5 5.4h14V7H5Z"/><path d="m13 1.9 1.4-.4 1 3.9h-1.5L13 1.9Z"/>`,
};

// Keywords, English and Spanish, matched as whole words (or word starts for plurals).
const KEYWORDS = {
  drink: ["coffee", "latte", "cappuccino", "espresso", "tea", "juice", "smoothie", "shake", "soda", "cola", "beer", "wine", "water", "kombucha", "drink", "café", "cafe", "té", "jugo", "zumo", "batido", "refresco", "cerveza", "vino", "agua", "bebida", "licuado"],
  sweet: ["cake", "cupcake", "cookie", "brownie", "chocolate", "candy", "ice cream", "donut", "doughnut", "pastry", "croissant", "muffin", "pie", "dessert", "flan", "churro", "pastel", "torta", "galleta", "dulce", "helado", "postre", "caramelo", "chips", "crisps", "popcorn", "bar"],
  egg: ["egg", "eggs", "omelet", "omelette", "frittata", "huevo", "huevos", "tortilla española", "revoltillo"],
  dairy: ["milk", "yogurt", "yoghurt", "cheese", "kefir", "cottage", "leche", "yogur", "queso", "cuajada"],
  fish: ["fish", "salmon", "tuna", "cod", "tilapia", "shrimp", "prawn", "sardine", "sushi", "poke", "ceviche", "seafood", "crab", "lobster", "pescado", "salmón", "atún", "camarón", "camarones", "gamba", "mariscos", "sardina", "bacalao"],
  meat: ["chicken", "beef", "steak", "pork", "ham", "bacon", "turkey", "lamb", "sausage", "burger", "hamburger", "meatball", "ribs", "pollo", "carne", "res", "cerdo", "jamón", "tocino", "pavo", "cordero", "salchicha", "chorizo", "hamburguesa", "albóndiga", "costilla", "milanesa"],
  bowl: ["rice", "pasta", "spaghetti", "noodle", "noodles", "ramen", "soup", "risotto", "curry", "bowl", "stew", "chili", "lasagna", "arroz", "fideos", "sopa", "caldo", "guiso", "lentejas", "frijoles", "bowl"],
  grain: ["bread", "toast", "sandwich", "bagel", "oats", "oatmeal", "porridge", "cereal", "granola", "pancake", "waffle", "tortilla", "wrap", "arepa", "pizza", "pan", "tostada", "avena", "cereales", "panqueque", "arepas", "empanada", "quinoa"],
  veg: ["salad", "broccoli", "spinach", "lettuce", "carrot", "tomato", "cucumber", "pepper", "vegetable", "veggie", "greens", "kale", "zucchini", "beans", "avocado", "ensalada", "brócoli", "espinaca", "lechuga", "zanahoria", "tomate", "pepino", "verdura", "vegetales", "aguacate", "calabacín"],
  fruit: ["apple", "banana", "orange", "berries", "berry", "strawberry", "blueberry", "grape", "mango", "pineapple", "melon", "watermelon", "pear", "peach", "kiwi", "fruit", "manzana", "plátano", "platano", "banano", "naranja", "fresa", "fresas", "uva", "piña", "sandía", "pera", "durazno", "fruta", "frutas", "papaya", "guayaba"],
};
// Tie-break order when two keywords start at the same place (rare: "ice cream" vs "cream").
const PRIORITY = ["drink", "sweet", "fish", "meat", "egg", "dairy", "bowl", "grain", "veg", "fruit"];

const norm = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const RULES = PRIORITY.map((cat) => ({
  cat,
  re: new RegExp(`(^|[^a-z])(${KEYWORDS[cat].map((k) => norm(k).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(s|es)?(?=$|[^a-z])`),
}));

/** The category of one name, or null when nothing matches. */
export function categoryOfName(name) {
  const n = norm(name);
  if (!n) return null;
  // The first food named leads ("arepa con queso" is bread, "yogurt with berries" is dairy);
  // PRIORITY only breaks ties at the same position.
  let best = null;
  for (const { cat, re } of RULES) {
    const m = re.exec(n);
    if (m && (best === null || m.index < best.index)) best = { cat, index: m.index };
  }
  return best?.cat ?? null;
}

/**
 * The category of a logged meal: its name first; otherwise the biggest item (by calories) that
 * matches; otherwise the fallback "plate".
 */
export function foodCategory(entry = {}) {
  const byName = categoryOfName(entry.name);
  if (byName) return byName;
  const items = Array.isArray(entry.analysisItems) ? entry.analysisItems : Array.isArray(entry.items) ? entry.items : [];
  const ranked = [...items].sort((a, b) => (Number(b?.calories) || 0) - (Number(a?.calories) || 0));
  for (const it of ranked) {
    const cat = categoryOfName(it?.name);
    if (cat) return cat;
  }
  return "plate";
}

/** Inline SVG for a category (or the plate fallback). */
export function foodIconSvg(category, { size = 20 } = {}) {
  const inner = GLYPHS[category];
  if (!inner) return iconSvg("forkKnife", { size }).replace("<svg ", '<svg class="food-icon" ');
  return `<svg class="food-icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${inner}</svg>`;
}
