// api/_week.js — the numbers behind the Friday recommendation, kept free of I/O so they can be
// tested. /api/weekly reads the rows, calls these, and asks Gemini only for the wording.

export const TIME_ZONE = (process.env.APP_TIME_ZONE || "America/Chicago").trim();
export const MIN_DAYS = 3; // fewer logged days than this and there's nothing honest to say

/** "YYYY-MM-DD" for a Date in the app's time zone. */
export function localDay(date, tz = TIME_ZONE) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

/** Weekday in the app's time zone, 0 = Sunday … 5 = Friday. */
export function localWeekday(date, tz = TIME_ZONE) {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(date);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(name);
}

function localHour(date, tz = TIME_ZONE) {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(date));
}

/** The 7 days that end yesterday: on a Friday that is last Friday through Thursday. */
export function weekWindow(now = new Date(), tz = TIME_ZONE) {
  const today = localDay(now, tz);
  const shift = (day, n) => {
    const d = new Date(`${day}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  return { start: shift(today, -7), end: shift(today, -1), today };
}

const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const r0 = (v) => Math.round(v);

/**
 * @param {{meals:Array<{id,day,logged_at,name,calories,protein_g}>, exercise:Array<{day,data}>,
 *          weights:Array<{day,data}>, goals:{calories,proteinG}|null, profile:object, tz?:string}} input
 */
export function summarizeWeek({ meals = [], exercise = [], weights = [], goals = null, profile = {}, tz = TIME_ZONE }) {
  const byDay = new Map();
  const slots = { morning: 0, afternoon: 0, evening: 0 };
  for (const m of meals) {
    const kcal = n(m.calories);
    const d = byDay.get(m.day) ?? { calories: 0, proteinG: 0, meals: 0 };
    d.calories += kcal;
    d.proteinG += n(m.protein_g);
    d.meals += 1;
    byDay.set(m.day, d);
    const h = localHour(new Date(m.logged_at), tz);
    slots[h < 11 ? "morning" : h < 17 ? "afternoon" : "evening"] += kcal;
  }
  const days = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, v]) => ({ day, calories: r0(v.calories), proteinG: r0(v.proteinG), meals: v.meals }));
  const logged = days.length;
  const total = days.reduce((s, d) => s + d.calories, 0);
  const avg = logged ? total / logged : 0;
  const avgProtein = logged ? days.reduce((s, d) => s + d.proteinG, 0) / logged : 0;
  const target = goals?.calories ?? null;
  const overBy = target ? Math.max(100, target * 0.1) : null; // small misses aren't "over"
  const daysOver = target ? days.filter((d) => d.calories > target + overBy).map((d) => d.day) : [];
  const daysUnderProtein = goals?.proteinG ? days.filter((d) => d.proteinG < goals.proteinG * 0.8).length : 0;

  const w = [...weights].map((x) => ({ day: x.day, kg: n(x.data?.kg) })).filter((x) => x.kg > 0).sort((a, b) => a.day.localeCompare(b.day));
  const weightChangeKg = w.length >= 2 ? Math.round((w[w.length - 1].kg - w[0].kg) * 10) / 10 : null;

  const exerciseMin = exercise.reduce((s, x) => s + n(x.data?.minutes), 0);
  const exerciseKcal = exercise.reduce((s, x) => s + n(x.data?.caloriesBurned), 0);

  return {
    daysLogged: logged,
    enough: logged >= MIN_DAYS,
    avgCalories: r0(avg),
    targetCalories: target,
    avgProteinG: r0(avgProtein),
    targetProteinG: goals?.proteinG ?? null,
    daysOver,
    daysUnderProtein,
    eveningShare: total ? Math.round((slots.evening / total) * 100) : 0,
    weightChangeKg,
    exerciseMin: r0(exerciseMin),
    exerciseKcal: r0(exerciseKcal),
    goal: typeof profile.goal === "string" ? profile.goal : n(profile.targetDeltaKcal) < 0 ? "lose" : n(profile.targetDeltaKcal) > 0 ? "gain" : "maintain",
    days,
  };
}

/** The meals worth talking about, labelled m1…mN so the model can point at them. Biggest first. */
export function candidateMeals(meals, limit = 30) {
  return [...meals]
    .sort((a, b) => n(b.calories) - n(a.calories))
    .slice(0, limit)
    .map((m, i) => ({ ref: `m${i + 1}`, id: m.id, day: m.day, name: String(m.name ?? "").slice(0, 60), calories: r0(n(m.calories)), proteinG: r0(n(m.protein_g)) }));
}

export function buildPrompt({ name, language, stats, candidates }) {
  const es = language === "es";
  const lines = candidates.map((c) => `${c.ref} | ${c.day} | ${c.name} | ${c.calories} kcal | ${c.proteinG} g protein`).join("\n");
  return `You are a practical nutrition coach writing a private weekly check-in for ${name || "this person"}.
Write in ${es ? "Spanish (Colombian, informal tú)" : "English"}.

Their goal: ${stats.goal}. Daily target: ${stats.targetCalories ?? "unknown"} kcal, ${stats.targetProteinG ?? "unknown"} g protein.
Last 7 days: logged ${stats.daysLogged} days, averaged ${stats.avgCalories} kcal and ${stats.avgProteinG} g protein a day.
Days clearly over target: ${stats.daysOver.join(", ") || "none"}. Days under 80% of protein target: ${stats.daysUnderProtein}.
Share of calories eaten after 5pm: ${stats.eveningShare}%. Weight change: ${stats.weightChangeKg ?? "not tracked"} kg. Exercise: ${stats.exerciseMin} min.
Daily totals: ${stats.days.map((d) => `${d.day}=${d.calories}kcal/${d.proteinG}g`).join(", ")}

Their biggest meals this week (ref | day | name | kcal | protein):
${lines || "(none)"}

Give exactly 3 recommendations that would most help them reach their goal next week. Each must be specific to what they actually ate: name the meal and day, and say exactly what to change (swap, portion, timing, add protein), with rough numbers. Point at the meals you mean using their refs. If they did well, one recommendation can be to keep doing a specific thing. No medical advice, no shaming, no generic tips like "drink water".
Also write a one-sentence headline summarising their week honestly.`;
}

export const RECAP_SCHEMA = {
  type: "OBJECT",
  properties: {
    headline: { type: "STRING" },
    tips: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          title: { type: "STRING" },
          body: { type: "STRING" },
          mealRefs: { type: "ARRAY", items: { type: "STRING" } },
        },
        required: ["title", "body", "mealRefs"],
      },
    },
  },
  required: ["headline", "tips"],
};

/** Keep only what the card shows; map the model's m-refs back to real meal ids, dropping unknown ones. */
export function cleanRecap(raw, candidates) {
  const byRef = new Map(candidates.map((c) => [c.ref, c]));
  const str = (v, max) => String(v ?? "").trim().slice(0, max);
  const tips = (Array.isArray(raw?.tips) ? raw.tips : []).slice(0, 3).map((tip) => ({
    title: str(tip?.title, 80),
    body: str(tip?.body, 360),
    meals: (Array.isArray(tip?.mealRefs) ? tip.mealRefs : [])
      .map((ref) => byRef.get(String(ref).trim()))
      .filter(Boolean)
      .slice(0, 3)
      .map((c) => ({ id: c.id, day: c.day, name: c.name, calories: c.calories })),
  })).filter((tip) => tip.title && tip.body);
  return { headline: str(raw?.headline, 200), tips };
}
