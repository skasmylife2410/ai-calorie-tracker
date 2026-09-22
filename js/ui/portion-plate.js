// portion-plate.js — a to-scale drawing of a meal, so you can check your eyeballing.
//
// Not AI and not a photo: each ingredient's grams are turned into a volume (grams ÷ a typical
// density for that kind of food), then into a footprint on a real-size 26 cm dinner plate
// (volume ÷ how high that food usually sits). Drinks go in a glass beside the plate instead.
// Because the sizes are computed, the proportions are right by construction — within the
// accuracy of "typical density", which is why the card says "approximate".
//
// Each ingredient also gets a hand-size reference, the method dietitians teach:
//   palm  ≈ 100 g of cooked meat/fish/tofu          (protein)
//   fist  ≈ 1 cup / 240 ml                          (vegetables, fruit)
//   cupped hand ≈ ½ cup / 120 ml                   (rice, pasta, grains, beans)
//   thumb ≈ 1 tablespoon / 15 ml                    (oils, butter, nut butters, sauces)
//   glass ≈ 250 ml                                  (drinks)

const PLATE_CM = 26;      // a standard dinner plate
const RIM_CM = 2.5;       // the flat rim, which food doesn't sit on

// kind: density g/ml, height cm, hand unit, and the words that identify it (English + Spanish)
const KINDS = {
  drink:   { density: 1.0,  height: 0,   hand: "glass", color: "#A9D3F2", words: ["coffee", "café", "cafe", "tea", "té", "juice", "jugo", "zumo", "milk", "leche", "soda", "gaseosa", "water", "agua", "smoothie", "batido", "shake", "beer", "cerveza", "wine", "vino", "latte", "cappuccino", "tinto", "chocolate caliente", "avena líquida", "kombucha"] },
  soup:    { density: 1.0,  height: 0,   hand: "fist",  color: "#F2C58A", words: ["soup", "sopa", "sancocho", "ajiaco", "caldo", "broth", "stew", "consomé", "crema de"] },
  fat:     { density: 0.95, height: 1.0, hand: "thumb", color: "#F5E08A", words: ["oil", "aceite", "butter", "mantequilla", "mayo", "mayonesa", "peanut butter", "mantequilla de maní", "nutella", "dressing", "aderezo", "sauce", "salsa", "hogao", "guacamole", "cream", "crema", "ghee", "margarina"] },
  protein: { density: 1.05, height: 2.0, hand: "palm",  color: "#E8A48A", words: ["chicken", "pollo", "beef", "carne", "res", "steak", "bistec", "pork", "cerdo", "chicharrón", "fish", "pescado", "salmon", "salmón", "tuna", "atún", "shrimp", "camarón", "camarones", "egg", "huevo", "huevos", "turkey", "pavo", "tofu", "ham", "jamón", "sausage", "salchicha", "chorizo", "lamb", "cordero", "tilapia", "mojarra", "meatball", "albóndiga"] },
  grain:   { density: 0.85, height: 2.5, hand: "cup",   color: "#F4E3C1", words: ["rice", "arroz", "pasta", "spaghetti", "espagueti", "noodle", "fideo", "quinoa", "couscous", "oats", "avena", "beans", "frijoles", "fríjoles", "lentils", "lentejas", "chickpeas", "garbanzos", "cereal", "granola", "corn", "maíz", "mazorca"] },
  bread:   { density: 0.35, height: 2.0, hand: "cup",   color: "#E6C18F", words: ["bread", "pan", "toast", "tostada", "bagel", "bun", "tortilla", "wrap", "pita", "croissant", "roll", "arepa", "empanada", "buñuelo", "pandebono", "almojábana", "galleta", "cracker", "pancake", "panqueque", "waffle"] },
  starch:  { density: 0.8,  height: 3.0, hand: "cup",   color: "#EBD08E", words: ["potato", "papa", "papas", "fries", "sweet potato", "batata", "camote", "yuca", "cassava", "plantain", "plátano maduro", "patacón", "patacones", "tajadas"] },
  veg:     { density: 0.45, height: 3.5, hand: "fist",  color: "#9ED39A", words: ["salad", "ensalada", "lettuce", "lechuga", "spinach", "espinaca", "broccoli", "brócoli", "vegetable", "verdura", "vegetales", "tomato", "tomate", "cucumber", "pepino", "carrot", "zanahoria", "onion", "cebolla", "pepper", "pimentón", "zucchini", "calabacín", "cabbage", "repollo", "green beans", "habichuela", "mushroom", "champiñón", "kale", "asparagus", "espárrago"] },
  fruit:   { density: 0.9,  height: 4.0, hand: "fist",  color: "#F6A7B8", words: ["banana", "banano", "apple", "manzana", "orange", "naranja", "mango", "papaya", "pineapple", "piña", "berries", "fresas", "strawberr", "blueberr", "arándano", "grape", "uva", "melon", "melón", "watermelon", "sandía", "pear", "pera", "fruit", "fruta", "guayaba", "maracuyá", "lulo", "avocado", "aguacate"] },
  cheese:  { density: 1.1,  height: 1.5, hand: "thumb", color: "#F7D56E", words: ["cheese", "queso", "cuajada", "parmesan", "mozzarella", "cheddar"] },
  nuts:    { density: 0.6,  height: 2.0, hand: "thumb", color: "#C99B6D", words: ["nuts", "nueces", "almond", "almendra", "peanut", "maní", "cashew", "marañón", "walnut", "seeds", "semillas", "chia", "chía"] },
};

const FALLBACK = { density: 0.8, height: 2.5, hand: "fist", color: "#D9D4CC" };

/**
 * What kind of food a name describes. The word that comes FIRST wins, because dishes are named
 * main-thing-first: "arepa con queso" is an arepa, "café con leche" is a coffee, "huevos con
 * queso" is eggs. On a tie the longer match wins, so "peanut butter" is a fat, not nuts.
 */
export function kindOf(name) {
  const n = String(name ?? "").toLowerCase();
  let best = null;
  for (const [key, kind] of Object.entries(KINDS)) {
    for (const w of kind.words) {
      const at = n.indexOf(w);
      if (at === -1) continue;
      if (!best || at < best.at || (at === best.at && w.length > best.len)) best = { key, at, len: w.length };
    }
  }
  return best ? best.key : "other";
}

const spec = (kind) => KINDS[kind] ?? FALLBACK;

/** ml for an ingredient, from its grams and the typical density of its kind. */
export function volumeMl(item) {
  const g = Math.max(0, Number(item.gramsEstimate) || 0);
  return g / spec(kindOf(item.name)).density;
}

const HAND_ML = { fist: 240, cup: 120, thumb: 15, glass: 250 };

/** How many hand-units this is, rounded to the nearest half. */
export function handReference(item) {
  const kind = kindOf(item.name);
  const s = spec(kind);
  const g = Math.max(0, Number(item.gramsEstimate) || 0);
  const count = s.hand === "palm" ? g / 100 : volumeMl(item) / HAND_ML[s.hand];
  const rounded = Math.max(0.5, Math.round(count * 2) / 2);
  return { hand: s.hand, count: rounded, kind };
}

const HAND_WORDS = {
  en: { palm: ["palm", "palms"], fist: ["fist", "fists"], cup: ["cupped hand", "cupped hands"], thumb: ["thumb", "thumbs"], glass: ["glass", "glasses"] },
  es: { palm: ["palma", "palmas"], fist: ["puño", "puños"], cup: ["mano ahuecada", "manos ahuecadas"], thumb: ["pulgar", "pulgares"], glass: ["vaso", "vasos"] },
};

export function handLabel({ hand, count }, lang = "en") {
  const words = (HAND_WORDS[lang] ?? HAND_WORDS.en)[hand];
  const whole = Math.floor(count);
  const half = count - whole >= 0.5;
  const num = whole === 0 ? "½" : `${whole}${half ? "½" : ""}`;
  return `≈ ${num} ${count > 1 ? words[1] : words[0]}`;
}

/** Footprint radius in cm for a food on the plate (area = volume / height). */
function footprintRadiusCm(item) {
  const s = spec(kindOf(item.name));
  if (!s.height) return 0;
  const area = volumeMl(item) / s.height; // cm²
  return Math.sqrt(area / Math.PI);
}

/**
 * Places foods on the plate, biggest first. Each goes where it overlaps the others least,
 * nudged toward the middle on ties — like serving a real plate. When a meal is too big to fit
 * side by side, foods share edges rather than piling into the centre; how much of the plate is
 * covered is reported separately as `fullness`.
 */
function layout(circles, maxR) {
  const placed = [];
  const sorted = [...circles].sort((a, b) => b.r - a.r);
  // candidate spots: a grid over the eating area
  const spots = [];
  for (let x = -maxR; x <= maxR; x += 0.4) {
    for (let y = -maxR; y <= maxR; y += 0.4) {
      if (Math.hypot(x, y) <= maxR) spots.push([x, y]);
    }
  }
  for (const c of sorted) {
    let best = null;
    for (const [x, y] of spots) {
      // keep the whole food on the plate where possible
      const edge = Math.max(0, Math.hypot(x, y) + c.r - maxR);
      let overlap = 0;
      for (const p of placed) overlap += Math.max(0, p.r + c.r - Math.hypot(p.x - x, p.y - y));
      const score = overlap * 10 + edge * 6 + Math.hypot(x, y) * 0.05;
      if (!best || score < best.score) best = { score, x, y };
    }
    placed.push({ ...c, x: best.x, y: best.y });
  }
  return placed;
}

/**
 * @param {Array<{name:string, gramsEstimate:number}>} items
 * @returns {{svg:string, fullness:number, order:string[]}}
 *   svg: markup sized to its container; fullness: share of the eating area covered (1 = full);
 *   order: names of the foods on the plate, in the order they're numbered in the drawing.
 */
export function plateSvg(items, { lang = "en" } = {}) {
  const S = 10; // px per cm in the drawing's own units
  const plateR = (PLATE_CM / 2) * S;
  const innerR = plateR - RIM_CM * S;
  const cx = plateR + 6, cy = plateR + 6;

  const onPlate = items.filter((i) => spec(kindOf(i.name)).height > 0 && Number(i.gramsEstimate) > 0);
  const drinks = items.filter((i) => ["drink", "soup"].includes(kindOf(i.name)) && Number(i.gramsEstimate) > 0);

  const circles = layout(
    onPlate.map((i) => ({ item: i, r: footprintRadiusCm(i) })),
    (innerR / S) - 0.3
  );

  const byItem = new Map(onPlate.map((i, n) => [i, n + 1])); // numbers follow the ingredient list order
  const covered = circles.reduce((a, c) => a + Math.PI * c.r * c.r, 0);
  const fullness = covered / (Math.PI * ((innerR / S) ** 2));

  const blobs = circles.map((c) => {
    const s = spec(kindOf(c.item.name));
    const r = c.r * S;
    const x = cx + c.x * S, y = cy + c.y * S;
    // a slightly lumpy outline so it reads as food, not a chart
    const pts = Array.from({ length: 14 }, (_, k) => {
      const a = (k / 14) * Math.PI * 2;
      const wobble = 1 + 0.07 * Math.sin(k * 2.7 + c.r);
      return `${(x + Math.cos(a) * r * wobble).toFixed(1)},${(y + Math.sin(a) * r * wobble).toFixed(1)}`;
    }).join(" ");
    const num = byItem.get(c.item);
    const label = r > 9 ? `<text x="${x.toFixed(1)}" y="${(y + 4.5).toFixed(1)}" text-anchor="middle" class="plate-num">${num}</text>` : "";
    return `<polygon points="${pts}" fill="${s.color}" stroke="rgba(0,0,0,.18)" stroke-width="1.2" stroke-linejoin="round"/>${label}`;
  }).join("");

  // drinks: a glass to the right of the plate, filled to scale (a 330 ml glass)
  const glassW = 58, glassH = 110;
  const gx = cx + plateR + 22, gy = cy + plateR - glassH;
  const drinkMl = drinks.reduce((n, d) => n + volumeMl(d), 0);
  const fill = Math.min(1, drinkMl / 330);
  const glass = drinks.length ? `
    <g>
      <path d="M${gx} ${gy} L${gx + glassW} ${gy} L${gx + glassW - 7} ${gy + glassH} L${gx + 7} ${gy + glassH} Z" fill="rgba(255,255,255,.7)" stroke="rgba(0,0,0,.28)" stroke-width="2"/>
      <clipPath id="glassclip"><path d="M${gx} ${gy} L${gx + glassW} ${gy} L${gx + glassW - 7} ${gy + glassH} L${gx + 7} ${gy + glassH} Z"/></clipPath>
      <rect clip-path="url(#glassclip)" x="${gx - 2}" y="${(gy + glassH * (1 - fill)).toFixed(1)}" width="${glassW + 4}" height="${(glassH * fill).toFixed(1)}" fill="${spec(kindOf(drinks[0].name)).color}"/>
    </g>` : "";

  const width = cx + plateR + (drinks.length ? 22 + glassW + 8 : 8);
  const height = cy + plateR + 8;
  const svg = `
    <svg class="plate-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Portion drawing">
      <circle cx="${cx}" cy="${cy}" r="${plateR}" fill="#FFFFFF" stroke="rgba(0,0,0,.12)" stroke-width="2"/>
      <circle cx="${cx}" cy="${cy}" r="${innerR}" fill="#FBFAF8" stroke="rgba(0,0,0,.06)" stroke-width="1.5"/>
      ${blobs}
      ${glass}
    </svg>`;
  return { svg, fullness, order: onPlate.map((i) => i.name) };
}

export const _KINDS_FOR_TESTS = KINDS;
