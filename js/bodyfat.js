// bodyfat.js — two honest ways to get a body fat number without a lab.
//
// 1. Pick the shape that looks most like you. Rough (±4–5 points), but far better than a
//    guess, and better than nothing: the number only shifts the starting estimate, and the
//    learned maintenance replaces it after two weeks anyway.
// 2. Measure with a tape (the US Navy method). Usually within ~3 points of a DEXA scan for
//    most people, and the best you can do at home.
//
// The silhouettes are drawn here rather than photographed: nobody needs pictures of strangers'
// bodies in a calorie app, and drawings compare better because only the shape changes.

/** Ranges people can recognise, with what actually gives each one away. */
export const BF_RANGES = {
  male: [
    { pct: 10, label: "8–12%", w: 0.80, desc: "Abs clearly visible, veins on the arms, very little softness anywhere." },
    { pct: 15, label: "13–17%", w: 0.92, desc: "Flat stomach, top abs show, a little softness at the waist." },
    { pct: 20, label: "18–22%", w: 1.06, desc: "No visible abs, slight belly, jaw still defined." },
    { pct: 26, label: "23–29%", w: 1.22, desc: "Noticeable belly, waist wider than chest at the navel, fuller face." },
    { pct: 34, label: "30%+", w: 1.42, desc: "Belly clearly overhangs the belt, rounder neck and face." },
  ],
  female: [
    { pct: 18, label: "15–20%", w: 0.82, desc: "Abs visible, very defined arms and shoulders — athlete territory." },
    { pct: 23, label: "21–25%", w: 0.94, desc: "Flat stomach, some ab definition, curvy but lean." },
    { pct: 28, label: "26–30%", w: 1.08, desc: "Soft belly, hips and thighs carry more, no ab definition." },
    { pct: 34, label: "31–36%", w: 1.24, desc: "Rounder hips and thighs, belly clearly soft, fuller face." },
    { pct: 40, label: "37%+", w: 1.44, desc: "Fuller all over, belly and hips noticeably rounded." },
  ],
};

/**
 * A simple front-on silhouette whose waist and hips widen with body fat. Same figure every
 * time apart from the shape, so the comparison is honest.
 * @param {"male"|"female"} sex
 * @param {number} w  width factor from BF_RANGES
 */
export function silhouetteSvg(sex, w, { size = 78 } = {}) {
  const female = sex === "female";
  const shoulder = female ? 21 : 25;
  const waist = (female ? 13 : 15) * w;
  const hip = (female ? 19 : 16) * (female ? 1 + (w - 1) * 0.8 : w);
  const thigh = hip * 0.52;
  const neck = female ? 4.5 : 5.5 * Math.min(1.2, w);
  return `
    <svg viewBox="0 0 80 150" width="${size}" height="${Math.round(size * 1.875)}" role="img" aria-hidden="true">
      <g fill="currentColor">
        <circle cx="40" cy="17" r="10"/>
        <rect x="${40 - neck / 2}" y="25" width="${neck}" height="6"/>
        <path d="M${40 - shoulder} 34
                 Q40 28 ${40 + shoulder} 34
                 L${40 + waist} 74
                 Q40 78 ${40 - waist} 74 Z"/>
        <path d="M${40 - waist} 72
                 Q${40 - hip} 84 ${40 - hip * 0.92} 96
                 L${40 - thigh} 150 L${40 - 3} 150 L${40 - 2} 100
                 L${40 + 2} 100 L${40 + 3} 150 L${40 + thigh} 150
                 L${40 + hip * 0.92} 96 Q${40 + hip} 84 ${40 + waist} 72 Z"/>
        <path d="M${40 - shoulder + 3} 33 Q${40 - shoulder - 6} 52 ${40 - waist - 7} 82 L${40 - waist - 1} 83 Q${40 - shoulder + 1} 54 ${40 - shoulder + 9} 34 Z"/>
        <path d="M${40 + shoulder - 3} 33 Q${40 + shoulder + 6} 52 ${40 + waist + 7} 82 L${40 + waist + 1} 83 Q${40 + shoulder - 1} 54 ${40 + shoulder - 9} 34 Z"/>
      </g>
    </svg>`;
}

/**
 * US Navy body fat from a tape measure, in CENTIMETRES.
 * The widely-quoted 86.010/163.205 constants are for INCHES — feeding them centimetres gives
 * wildly wrong answers (a lean woman came out at 55%). These are the metric forms:
 *   men:   495 / (1.0324 − 0.19077·log10(waist − neck) + 0.15456·log10(height)) − 450
 *   women: 495 / (1.29579 − 0.35004·log10(waist + hip − neck) + 0.22100·log10(height)) − 450
 * @returns {number|null} percentage, or null when the measurements can't be right
 */
export function navyBodyFat({ sex, heightCm, neckCm, waistCm, hipCm }) {
  const h = Number(heightCm), n = Number(neckCm), wst = Number(waistCm), hip = Number(hipCm);
  const female = sex === "female";
  if (!(h > 100 && h < 250) || !(n > 20 && n < 70) || !(wst > 40 && wst < 200)) return null;
  if (female && !(hip > 50 && hip < 200)) return null;

  const inner = female ? wst + hip - n : wst - n;
  if (inner <= 0) return null;

  const pct = female
    ? 495 / (1.29579 - 0.35004 * Math.log10(inner) + 0.22100 * Math.log10(h)) - 450
    : 495 / (1.0324 - 0.19077 * Math.log10(inner) + 0.15456 * Math.log10(h)) - 450;

  if (!Number.isFinite(pct) || pct < 3 || pct > 65) return null;
  return Math.round(pct * 10) / 10;
}

/** The nearest range to a measured percentage, so the picker can show what they measured. */
export function rangeFor(sex, pct) {
  const list = BF_RANGES[sex === "female" ? "female" : "male"];
  return list.reduce((best, r) => (Math.abs(r.pct - pct) < Math.abs(best.pct - pct) ? r : best), list[0]);
}
