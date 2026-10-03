// progress.js — everything the Progress tab measures, as plain functions over plain data.
//
// Nothing here reads the store or touches the page, so every rule is testable on its own:
//   buildDays()   one record per calendar day: calories vs target, protein, workouts, water, weight
//   summarize()   those days rolled up into the numbers the marker tiles show
//   insights()    the few changes worth saying out loud, most significant first
//   milestones()  wins found anywhere in the history: streaks, weights reached, counts
// js/ui/weight.js (the Progress tab) gathers the data from the store and draws the result.

import { localDateString, startOfDay, addDays } from "./nutrition.js";

export const ON_TARGET = 0.1;       // up to 10% under the day's calorie target counts as on target; any amount over is over (as on Home)
export const WATER_GOAL = 8;        // glasses, same as the Home water ring
export const STREAK_MARKS = [7, 14, 30, 60, 100, 180, 365];
export const MEAL_MARKS = [50, 100, 250, 500, 1000, 2500];
export const WORKOUT_MARKS = [1, 10, 25, 50, 100, 250];

const ok = (e) => e && e.isPending !== true && e.analysisFailed !== true;

/** 7-reading rolling average, the same smoothing the weight card has always used. */
export function rollingWeights(weights) {
  const sorted = [...weights].filter((w) => Number.isFinite(w?.kg)).sort((a, b) => a.timestamp - b.timestamp);
  return sorted.map((w, i) => {
    const win = sorted.slice(Math.max(0, i - 6), i + 1);
    return { ...w, key: localDateString(w.timestamp), avg: Math.round((win.reduce((s, x) => s + x.kg, 0) / win.length) * 10) / 10 };
  });
}

/**
 * One record per day for the `days` days ending today (oldest first).
 * @param {object} p
 * @param {(ts:number)=>number} p.calorieTarget  that day's calorie target (with exercise credit)
 * @param {number} p.proteinTarget  grams
 */
export function buildDays({ days, now = Date.now(), foods = [], exercise = [], water = [], weights = [], calorieTarget, proteinTarget = 0 }) {
  const byDay = new Map();
  const bucket = (key) => {
    if (!byDay.has(key)) byDay.set(key, { calories: 0, proteinG: 0, meals: 0, workouts: 0, minutes: 0, burned: 0, water: 0 });
    return byDay.get(key);
  };
  for (const e of foods) {
    if (!ok(e)) continue;
    const b = bucket(localDateString(e.timestamp));
    b.calories += Number(e.calories) || 0;
    b.proteinG += Number(e.proteinG) || 0;
    b.meals += 1;
  }
  for (const x of exercise) {
    const b = bucket(localDateString(x.timestamp));
    b.workouts += 1;
    b.minutes += Number(x.minutes) || 0;
    b.burned += Number(x.caloriesBurned) || 0;
  }
  for (const w of water) {
    // stored rows carry `date` (start of day, ms); synced ones may carry a `day` key
    const key = w?.day ?? (Number.isFinite(w?.date) ? localDateString(w.date) : null);
    if (key) bucket(key).water = Number(w.glasses) || 0;
  }
  const weighIns = new Map(rollingWeights(weights).map((w) => [w.key, w]));

  const today = startOfDay(now);
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const ts = addDays(today, -i);
    const key = localDateString(ts);
    const b = byDay.get(key) ?? { calories: 0, proteinG: 0, meals: 0, workouts: 0, minutes: 0, burned: 0, water: 0 };
    const target = typeof calorieTarget === "function" ? calorieTarget(ts) : calorieTarget;
    const logged = b.meals > 0;
    let calStatus = null;
    if (logged && target > 0) {
      // Home calls a day over the moment it passes the target, so Progress does too
      calStatus = Math.round(b.calories) > Math.round(target) ? "over" : b.calories < target * (1 - ON_TARGET) ? "under" : "on";
    }
    const w = weighIns.get(key);
    out.push({
      key, ts, logged, target: target || 0,
      calories: Math.round(b.calories), proteinG: Math.round(b.proteinG), meals: b.meals,
      calStatus,
      proteinHit: logged && proteinTarget > 0 ? b.proteinG >= proteinTarget * 0.95 : null,
      workouts: b.workouts, minutes: b.minutes, burned: Math.round(b.burned),
      water: b.water, waterHit: b.water >= WATER_GOAL,
      weightKg: w?.kg ?? null, weightAvg: w?.avg ?? null,
      weekend: [0, 6].includes(new Date(ts).getDay()),
    });
  }
  return out;
}

/** The numbers behind the marker tiles, for one stretch of days. */
export function summarize(days) {
  const logged = days.filter((d) => d.logged);
  const weighed = days.filter((d) => d.weightAvg !== null);
  const avg = (arr, k) => (arr.length ? arr.reduce((s, d) => s + d[k], 0) / arr.length : null);
  const waterDays = days.filter((d) => d.water > 0);
  return {
    total: days.length,
    daysLogged: logged.length,
    onTarget: logged.filter((d) => d.calStatus === "on").length,
    avgCalories: avg(logged, "calories"),
    proteinHit: logged.filter((d) => d.proteinHit).length,
    avgProtein: avg(logged, "proteinG"),
    workouts: days.reduce((s, d) => s + d.workouts, 0),
    minutes: days.reduce((s, d) => s + d.minutes, 0),
    burned: days.reduce((s, d) => s + d.burned, 0),
    avgWater: waterDays.length ? avg(waterDays, "water") : null,
    waterHit: days.filter((d) => d.waterHit).length,
    weightStart: weighed.length ? weighed[0].weightAvg : null,
    weightEnd: weighed.length ? weighed[weighed.length - 1].weightAvg : null,
    weightDelta: weighed.length >= 2 ? Math.round((weighed[weighed.length - 1].weightAvg - weighed[0].weightAvg) * 10) / 10 : null,
    weighIns: weighed.length,
    // the time the weight change actually covers (first to last weigh-in), not the whole range
    weightDays: weighed.length >= 2 ? Math.max(1, Math.round((weighed[weighed.length - 1].ts - weighed[0].ts) / 86400000)) : 0,
  };
}

/** +1 when a weight change is good for this goal, -1 when it's the wrong way, 0 when it's neutral. */
export function weightDirection(delta, goal) {
  if (!delta || Math.abs(delta) < 0.2) return 0;
  if (goal === "lose") return delta < 0 ? 1 : -1;
  if (goal === "gain") return delta > 0 ? 1 : -1;
  return Math.abs(delta) <= 1 ? 1 : -1; // maintain: small drift is fine
}

/**
 * Up to `limit` plain-language findings comparing this stretch with the one before it.
 * Each is { key, vars, tone: "good"|"bad"|"neutral" } for the UI to translate; the most
 * significant change comes first, and nothing is said about a number that didn't move.
 */
export function insights({ cur, prev, goal, days, weekendGap = null, limit = 3 }) {
  const found = [];
  const pct = (n, total) => (total > 0 ? n / total : 0);

  if (cur.weightDelta !== null && cur.weighIns >= 3) {
    const dir = weightDirection(cur.weightDelta, goal);
    const span = cur.weightDays || days; // a year's range with two months of weigh-ins is two months
    const weeks = Math.max(1, span / 7);
    found.push({
      key: cur.weightDelta < 0 ? "prog.in.weightDown" : cur.weightDelta > 0 ? "prog.in.weightUp" : "prog.in.weightFlat",
      vars: { kg: Math.abs(cur.weightDelta), perWeek: Math.round((Math.abs(cur.weightDelta) / weeks) * 10) / 10, days: span },
      tone: dir > 0 ? "good" : dir < 0 ? "bad" : "neutral",
      score: 2 + Math.abs(cur.weightDelta),
    });
  }
  const compareCount = (field, keyUp, keyDown, weight = 1) => {
    if (cur.daysLogged < 3) return;
    const now = cur[field];
    const before = prev?.[field] ?? null;
    if (before === null || prev.daysLogged < 3) {
      if (now > 0) found.push({ key: `${keyUp}First`, vars: { n: now, total: cur.total }, tone: "neutral", score: 0.5 * weight });
      return;
    }
    const diff = now - before;
    if (diff === 0) return;
    found.push({
      key: diff > 0 ? keyUp : keyDown,
      vars: { n: now, total: cur.total, before, diff: Math.abs(diff) },
      tone: diff > 0 ? "good" : "bad",
      score: weight * (Math.abs(diff) / Math.max(3, cur.total / 4)),
    });
  };
  compareCount("onTarget", "prog.in.onTargetUp", "prog.in.onTargetDown", 1.4);
  compareCount("proteinHit", "prog.in.proteinUp", "prog.in.proteinDown", 1.2);
  compareCount("daysLogged", "prog.in.loggedUp", "prog.in.loggedDown", 1);
  compareCount("workouts", "prog.in.workoutsUp", "prog.in.workoutsDown", 1);

  if (weekendGap && Math.abs(weekendGap.gap) >= 250) {
    found.push({
      key: weekendGap.gap > 0 ? "prog.in.weekendMore" : "prog.in.weekendLess",
      vars: { kcal: Math.abs(weekendGap.gap) },
      tone: weekendGap.gap > 0 ? "bad" : "neutral",
      score: Math.abs(weekendGap.gap) / 300,
    });
  }
  if (found.length === 0 && pct(cur.daysLogged, cur.total) > 0) {
    found.push({ key: "prog.in.steady", vars: { n: cur.daysLogged, total: cur.total }, tone: "neutral", score: 0 });
  }
  return found.sort((a, b) => b.score - a.score).slice(0, limit).map(({ score, ...rest }) => rest);
}

/**
 * Wins found anywhere in the history, newest first. Each is { ts, kind, vars }.
 * Kinds: streak, meals, workouts, weightStep (each whole kg toward the goal), halfway, goal,
 * proteinWeek (first full week hitting protein every logged day).
 */
export function milestones({ foods = [], exercise = [], weights = [], goal = "maintain", goalKg = null, proteinTarget = 0, now = Date.now() }) {
  const out = [];
  const meals = foods.filter(ok).sort((a, b) => a.timestamp - b.timestamp);

  // meal counts
  meals.forEach((e, i) => { if (MEAL_MARKS.includes(i + 1)) out.push({ ts: e.timestamp, kind: "meals", vars: { n: i + 1 } }); });

  // logging streaks (a streak mark is reached on the day the run hits that length)
  const daySet = [...new Set(meals.map((e) => startOfDay(e.timestamp)))].sort((a, b) => a - b);
  let run = 0;
  let best = 0;
  daySet.forEach((d, i) => {
    run = i > 0 && addDays(daySet[i - 1], 1) === d ? run + 1 : 1;
    if (STREAK_MARKS.includes(run) && run > best) out.push({ ts: d, kind: "streak", vars: { n: run } });
    best = Math.max(best, run);
  });

  // workouts
  [...exercise].sort((a, b) => a.timestamp - b.timestamp).forEach((x, i) => {
    if (WORKOUT_MARKS.includes(i + 1)) out.push({ ts: x.timestamp, kind: "workouts", vars: { n: i + 1 } });
  });

  // protein: the first 7 logged days in a row that all hit the target
  if (proteinTarget > 0) {
    const perDay = new Map();
    for (const e of meals) {
      const k = startOfDay(e.timestamp);
      perDay.set(k, (perDay.get(k) ?? 0) + (Number(e.proteinG) || 0));
    }
    let hitRun = 0;
    for (const d of daySet) {
      hitRun = (perDay.get(d) ?? 0) >= proteinTarget * 0.95 ? hitRun + 1 : 0;
      if (hitRun === 7) { out.push({ ts: d, kind: "proteinWeek", vars: {} }); break; }
    }
  }

  // weight: every whole kg the 7-day average passes on the way to the goal, halfway, and the goal
  const series = rollingWeights(weights);
  if (series.length >= 2 && (goal === "lose" || goal === "gain")) {
    const down = goal === "lose";
    const start = series[0].avg;
    let mark = down ? Math.floor(start) : Math.ceil(start);
    if (mark === start) mark += down ? -1 : 1;
    let halfway = false;
    let reached = false;
    for (const w of series.slice(1)) {
      while (down ? w.avg <= mark : w.avg >= mark) {
        if (goalKg === null || (down ? mark >= goalKg : mark <= goalKg)) out.push({ ts: w.timestamp, kind: "weightStep", vars: { kg: mark } });
        mark += down ? -1 : 1;
      }
      if (goalKg !== null && Math.abs(goalKg - start) >= 1) {
        const done = (start - w.avg) * (down ? 1 : -1);
        if (!halfway && done >= Math.abs(goalKg - start) / 2) { halfway = true; out.push({ ts: w.timestamp, kind: "halfway", vars: { kg: goalKg } }); }
        if (!reached && (down ? w.avg <= goalKg : w.avg >= goalKg)) { reached = true; out.push({ ts: w.timestamp, kind: "goal", vars: { kg: goalKg } }); }
      }
    }
  }

  return out.filter((m) => m.ts <= now).sort((a, b) => b.ts - a.ts);
}
