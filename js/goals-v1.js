// goals-v1.js — the previous way goals were worked out (GOALS_VERSION 1), kept only so the app can
// show someone what their targets were before the update next to what they are now. Never used
// for a target anyone sees as current.
//   v1: calories = maintenance + the pace's change, with no safety limits; protein = 30% of
//   calories (raised to 1.6 g/kg, or 2.0 g/kg of lean mass, if that was more); fat 30%; carbs 40%
//   minus whatever protein took.

import { resolveUserGoals, macroTargets, leanMassKg } from "./nutrition.js";

export function goalsV1(profile, { learnedTdee = null } = {}) {
  const g = resolveUserGoals(profile, { learnedTdee });
  const custom = profile.customTargetKcal;
  const kcal = custom !== null && custom !== undefined ? Number(custom) : Math.round(g.tdee + (Number(profile.targetDeltaKcal) || 0));
  const m = macroTargets(kcal);
  let protein = m.proteinG;
  let carbs = m.carbsG;
  const w = Number(profile.weightKg);
  if (w > 0 && (profile.customProteinG === null || profile.customProteinG === undefined)) {
    const lbm = leanMassKg({ weightKg: w, bodyFatPct: profile.bodyFatPct, build: profile.build, sex: profile.sex });
    const floor = Math.round(lbm > 0 ? Math.max(w * 1.6, lbm * 2.0) : w * 1.6);
    if (floor > protein) { carbs = Math.max(0, Math.round(carbs - (floor - protein))); protein = floor; }
  }
  const pick = (v, k) => (profile[k] !== null && profile[k] !== undefined ? Number(profile[k]) : Math.round(v));
  return { calories: Math.round(kcal), proteinG: pick(protein, "customProteinG"), carbsG: pick(carbs, "customCarbsG"), fatG: pick(m.fatG, "customFatG") };
}
