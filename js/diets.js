// diets.js — how someone eats (vegan, gluten-free…), chosen in setup or Profile and stored on
// the profile as `diets: string[]`. Only "What should I eat?" (js/ui/recipes.js) uses it, to
// keep suggestions within the diet; logging is never restricted.

export const DIETS = ["vegetarian", "vegan", "pescatarian", "lowcarb", "glutenfree", "dairyfree", "halal", "kosher"];

/** What the suggestion prompt is told for each diet (English; the model answers in the app's language). */
const PROMPT = {
  vegetarian: "vegetarian (no meat, poultry or fish)",
  vegan: "vegan (no meat, fish, eggs, dairy or honey)",
  pescatarian: "pescatarian (fish and seafood, but no meat or poultry)",
  lowcarb: "low-carb / keto (keep carbohydrates very low)",
  glutenfree: "gluten-free (no wheat, barley or rye)",
  dairyfree: "dairy-free (no milk, cheese, yogurt or butter)",
  halal: "halal (no pork or alcohol)",
  kosher: "kosher (no pork or shellfish, never meat together with dairy)",
};

/** Keeps known diets only, in a stable order, without repeats. */
export function cleanDiets(list) {
  const set = new Set(Array.isArray(list) ? list : []);
  return DIETS.filter((d) => set.has(d));
}

/** Toggling a diet chip. Vegan implies vegetarian's rules already, so picking it drops the other. */
export function toggleDiet(list, key) {
  const cur = cleanDiets(list);
  if (!DIETS.includes(key)) return cur;
  if (cur.includes(key)) return cur.filter((d) => d !== key);
  const next = [...cur, key];
  if (key === "vegan") return cleanDiets(next.filter((d) => d !== "vegetarian" && d !== "pescatarian"));
  if (key === "vegetarian" || key === "pescatarian") return cleanDiets(next.filter((d) => d !== "vegan" && d !== (key === "vegetarian" ? "pescatarian" : "vegetarian")));
  return cleanDiets(next);
}

/** The preferences sent with a "What should I eat?" request: the diets, plus any free-form ones. */
export function recipePreferences(profile = {}) {
  const diets = cleanDiets(profile.diets).map((d) => PROMPT[d]);
  const extra = Array.isArray(profile.recipePreferences) ? profile.recipePreferences.filter((s) => typeof s === "string" && s.trim()) : [];
  return [...diets, ...extra];
}
