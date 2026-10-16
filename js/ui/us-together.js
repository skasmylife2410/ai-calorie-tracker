// us-together.js — "Day by day" on the Us tab: one chart for the whole group instead of one small
// chart per person. Measures: % of goal (fair across very different targets), calories, protein.
// Views: everyone (quiet grey lines), me, or the group average alone (with the day's spread).
// Up to three people are picked out in colour, each with its own end shape and a name label, so
// colour is never the only cue. Dragging across the chart reads any day; letting go opens that
// day's details (js/us.js dayDetailHtml).
//
// People who don't log don't skew it: a day logged at under half a goal is an unfinished day
// (a gap, never a crash in the line), and the group average only counts people who logged a full
// day on at least half the days since they started. Everyone else stays visible, marked.
// Protein is the exception: every logged day counts, a short one too.

import { t, formatDate } from "../i18n.js";
import { PARTIAL_DAY_SHARE } from "../nutrition.js";

const SHAPES = ["circle", "square", "diamond"];
const MAX_PICKED = 3;
// the chart's own state survives redraws and range changes for the session
const st = { metric: "pct", view: "everyone", picked: null, scrub: null };

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
// a name short enough for the chart's end labels: whole if it fits, else the first word, cut
const firstName = (p) => {
  const n = String(p.name || p.owner || "").trim();
  const w = n.length <= 8 ? n : n.split(/\s+/)[0];
  return w.length <= 9 ? w : `${w.slice(0, 8)}…`;
};

/**
 * A person's number for a day, or null: nothing logged, or (before today) under half their goal,
 * a day they didn't finish logging. Today counts as soon as anything is logged: it's "so far".
 * Protein counts on every logged day.
 */
export function dayValue(p, key, metric, todayKey) {
  const d = p?.days?.[key];
  if (!d || !(d.meals > 0)) return null;
  if (metric === "protein") return Number(d.proteinG) || 0;
  const goal = Number(p.goals?.calories) || 0;
  if (key !== todayKey && goal > 0 && d.calories < goal * PARTIAL_DAY_SHARE) return null;
  if (metric === "pct") return goal > 0 ? (d.calories / goal) * 100 : null;
  return Number(d.calories) || 0;
}

/**
 * Who the group average counts: people with a full day on at least half the days since they
 * started (within these days, today aside) and at least two. One big day a week would otherwise
 * swing the average whenever it happens.
 */
export function regulars(people, keys, todayKey) {
  const done = keys.filter((k) => k !== todayKey);
  return new Set(people.filter((p) => {
    const first = Object.keys(p.days ?? {}).filter((k) => p.days[k]?.meals > 0).sort()[0];
    if (!first) return false;
    const avail = done.filter((k) => k >= first);
    const full = avail.filter((k) => dayValue(p, k, "kcal", todayKey) !== null).length;
    return avail.length > 0 && full >= Math.max(2, Math.ceil(avail.length / 2));
  }).map((p) => p.owner));
}

/** The group's average for a day over the people who count, with how many it covers; or null. */
export function groupAverage(people, reg, key, metric, todayKey) {
  const v = people.filter((p) => reg.has(p.owner)).map((p) => dayValue(p, key, metric, todayKey)).filter((x) => x !== null);
  return v.length ? { v: v.reduce((a, b) => a + b, 0) / v.length, n: v.length } : null;
}

const mean = (vals) => { const v = vals.filter((x) => x !== null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };

function fmtV(v, m) {
  if (v === null || v === undefined) return "–";
  if (m === "pct") return `${Math.round(v)}%`;
  if (m === "protein") return `${Math.round(v)} g`;
  return Math.round(v).toLocaleString();
}

function shape(kind, x, y, r, fill, stroke) {
  const sw = stroke ? ` stroke="${stroke}" stroke-width="2"` : "";
  if (kind === "square") return `<rect x="${(x - r).toFixed(1)}" y="${(y - r).toFixed(1)}" width="${2 * r}" height="${2 * r}" rx="1.5" fill="${fill}"${sw}/>`;
  if (kind === "diamond") return `<path d="M${x.toFixed(1)} ${(y - r * 1.25).toFixed(1)}L${(x + r * 1.25).toFixed(1)} ${y.toFixed(1)}L${x.toFixed(1)} ${(y + r * 1.25).toFixed(1)}L${(x - r * 1.25).toFixed(1)} ${y.toFixed(1)}Z" fill="${fill}"${sw}/>`;
  return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" fill="${fill}"${sw}/>`;
}

/**
 * The section's inside. ctx: people; days (the Us tab's list, newest first, {ts, key}); me (the
 * signed-in owner); todayKey; selectedDay (whose details show below, or null); dayDetail(key, mark).
 */
export function togetherInner({ people, days, me, todayKey, selectedDay = null, dayDetail = () => "" }) {
  if (st.picked === null) st.picked = people.length <= MAX_PICKED ? people.map((p) => p.owner) : [];
  st.picked = st.picked.filter((o) => people.some((p) => p.owner === o));
  const ordered = [...days].reverse(); // oldest -> newest
  const keys = ordered.map((d) => d.key);
  const n = ordered.length;
  const m = st.metric;
  const todayIdx = keys.indexOf(todayKey);
  const reg = regulars(people, keys, todayKey);
  const series = people.map((p) => ({ p, vals: keys.map((k) => dayValue(p, k, m, todayKey)) }));
  const avgs = keys.map((k) => groupAverage(people, reg, k, m, todayKey));
  const av = avgs.map((a) => (a ? a.v : null));
  if (st.scrub !== null && st.scrub >= n) st.scrub = null;
  const at = st.scrub ?? (selectedDay ? keys.indexOf(selectedDay) : -1);
  const atIdx = at >= 0 ? at : null;

  // scale: % of goal always shows the goal line and room above it
  const { W, L, R } = GEO;
  const H = 232, TOP = 8, B = 20, pw = W - L - R, ph = H - TOP - B;
  const stepY = m === "kcal" ? 1000 : 50;
  let max = Math.max(m === "pct" ? 100 : stepY, ...series.flatMap((s) => s.vals.filter((v) => v !== null)), ...av.filter((v) => v !== null));
  max = Math.ceil((max * 1.05) / stepY) * stepY;
  if (m === "pct") max = Math.min(Math.max(max, 150), 250);
  const x = (i) => L + (n === 1 ? pw / 2 : (i * pw) / (n - 1));
  const y = (v) => TOP + ph - (Math.min(v, max) / max) * ph;
  const path = (vals) => {
    let d = "", pen = false;
    vals.forEach((v, i) => { if (v === null) { pen = false; return; } d += `${pen ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`; pen = true; });
    return d;
  };
  const lone = (vals) => vals.map((v, i) => (v !== null && (i === 0 || vals[i - 1] === null) && (i === n - 1 || vals[i + 1] === null) ? i : -1)).filter((i) => i >= 0);
  const done = (vals) => vals.map((v, i) => (i === todayIdx ? null : v)); // today is drawn on its own, fainter
  const lastIdx = (vals) => { for (let i = vals.length - 1; i >= 0; i--) if (vals[i] !== null) return i; return -1; };
  const nameOf = (p) => (p.owner === me ? t("us.you") : firstName(p));

  let g = "";
  for (let v = 0; v <= max; v += stepY) {
    g += `<line x1="${L}" x2="${W - R + 6}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" class="tc-grid"/>`
      + `<text x="${L - 6}" y="${(y(v) + 3.5).toFixed(1)}" text-anchor="end" class="tc-ax">${v === 0 ? "0" : m === "pct" ? `${v}%` : m === "kcal" ? `${v / 1000}k` : v}</text>`;
  }
  const goalLine = (gv, label) => `<line x1="${L}" x2="${W - R + 6}" y1="${y(gv).toFixed(1)}" y2="${y(gv).toFixed(1)}" class="tc-goal"/><text x="${L + 2}" y="${(y(gv) - 4).toFixed(1)}" class="tc-ax">${esc(label)}</text>`;
  if (m === "pct") g += goalLine(100, t("together.goal"));
  else if (st.picked.length === 1) {
    const p = people.find((q) => q.owner === st.picked[0]);
    const gv = m === "kcal" ? p?.goals?.calories : p?.goals?.proteinG;
    if (gv > 0 && gv <= max) g += goalLine(gv, p.owner === me ? t("together.yourGoal") : t("together.theirGoal", { name: firstName(p) }));
  }
  const every = n > 14 ? 7 : 1;
  ordered.forEach((d, i) => {
    if ((n - 1 - i) % every !== 0) return;
    const dt = new Date(d.ts);
    const label = i === todayIdx ? t("us.today") : n > 14 ? `${dt.getMonth() + 1}/${dt.getDate()}` : formatDate(d.ts, { weekday: "narrow" });
    g += `<text x="${x(i).toFixed(1)}" y="${H - 5}" text-anchor="middle" class="tc-ax">${esc(label)}</text>`;
  });

  // average view: the spread of the day (lowest to highest of the people who count)
  if (st.view === "avg") {
    let top = "", bot = "";
    keys.forEach((k, i) => {
      const v = people.filter((p) => reg.has(p.owner)).map((p) => dayValue(p, k, m, todayKey)).filter((q) => q !== null);
      if (v.length < 2) return;
      top += `${top ? "L" : "M"}${x(i).toFixed(1)} ${y(Math.max(...v)).toFixed(1)}`;
      bot = `L${x(i).toFixed(1)} ${y(Math.min(...v)).toFixed(1)}${bot}`;
    });
    if (top) g += `<path d="${top}${bot}Z" class="tc-band"/>`;
  }
  // everyone: each person a quiet grey line
  if (st.view === "everyone") {
    for (const s of series) {
      if (st.picked.includes(s.p.owner)) continue;
      g += `<path d="${path(s.vals)}" class="tc-ctx"/>${lone(s.vals).map((i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(s.vals[i]).toFixed(1)}" r="1.8" class="tc-ctx-dot"/>`).join("")}`;
    }
  }
  const labels = [];
  const drawLine = (vals, cls, mk, color, label) => {
    g += `<path d="${path(done(vals))}" class="${cls}"/>`;
    g += lone(done(vals)).map((i) => shape("circle", x(i), y(vals[i]), 2.2, color)).join("");
    if (todayIdx > 0 && vals[todayIdx] !== null && vals[todayIdx - 1] !== null) {
      g += `<path d="M${x(todayIdx - 1).toFixed(1)} ${y(vals[todayIdx - 1]).toFixed(1)}L${x(todayIdx).toFixed(1)} ${y(vals[todayIdx]).toFixed(1)}" class="${cls} is-today"/>`;
    }
    const li = lastIdx(vals);
    if (li < 0) return;
    g += shape(mk, x(li), y(vals[li]), mk === "circle" && cls === "tc-avg" ? 3.5 : 4, li === todayIdx ? "var(--tc-card)" : color, li === todayIdx ? color : null);
    labels.push({ y: y(vals[li]), v: fmtV(vals[li], m), t: label });
  };
  drawLine(av, "tc-avg", "circle", "var(--tc-ink)", t("together.avgShort"));
  st.picked.forEach((o, si) => {
    const s = series.find((q) => q.p.owner === o);
    if (s) drawLine(s.vals, `tc-line s${si + 1}`, SHAPES[si], `var(--tc-s${si + 1})`, nameOf(s.p));
  });
  labels.sort((a, b) => a.y - b.y);
  for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 22) labels[i].y = labels[i - 1].y + 22;
  for (const l of labels) g += `<text x="${W - R + 10}" y="${(l.y - 1).toFixed(1)}" class="tc-end-v">${esc(l.v)}</text><text x="${W - R + 10}" y="${(l.y + 10).toFixed(1)}" class="tc-ax">${esc(l.t)}</text>`;
  if (atIdx !== null) {
    g += `<line x1="${x(atIdx).toFixed(1)}" x2="${x(atIdx).toFixed(1)}" y1="${TOP}" y2="${TOP + ph}" class="tc-cursor"/>`;
    st.picked.forEach((o, si) => { const v = series.find((q) => q.p.owner === o)?.vals[atIdx]; if (v !== null && v !== undefined) g += shape(SHAPES[si], x(atIdx), y(v), 4, `var(--tc-s${si + 1})`, "var(--tc-card)"); });
    if (av[atIdx] !== null) g += shape("circle", x(atIdx), y(av[atIdx]), 3.5, "var(--tc-ink)", "var(--tc-card)");
  }

  // the three numbers: for the first person picked, else the group
  const doneKeys = keys.filter((k) => k !== todayKey);
  const focus = st.picked[0] ? series.find((q) => q.p.owner === st.picked[0]) : null;
  const fvals = focus ? done(focus.vals) : done(av);
  const logged = fvals.filter((v) => v !== null);
  let onTarget;
  if (m === "protein") {
    onTarget = focus
      ? doneKeys.filter((k) => { const v = dayValue(focus.p, k, "protein", todayKey); return v !== null && v >= (focus.p.goals?.proteinG || Infinity); }).length
      : doneKeys.filter((k) => {
        const ps = people.filter((p) => reg.has(p.owner) && dayValue(p, k, "protein", todayKey) !== null);
        return ps.length > 0 && ps.filter((p) => dayValue(p, k, "protein", todayKey) >= (p.goals?.proteinG || Infinity)).length * 2 >= ps.length;
      }).length;
  } else {
    const pcts = focus ? doneKeys.map((k) => dayValue(focus.p, k, "pct", todayKey)) : doneKeys.map((k) => groupAverage(people, reg, k, "pct", todayKey)?.v ?? null);
    onTarget = pcts.filter((v) => v !== null && v >= 90 && v <= 110).length;
  }
  const unit = (s) => esc(s).replace(/^([\d,.–]+)(.*)$/, (_, a, b) => `${a}<span class="u">${b}</span>`);
  const who = focus ? (focus.p.owner === me ? t("together.you") : firstName(focus.p)) : t("together.theGroup");
  const kpis = `
    <div class="tc-kpis">
      <div class="tc-kpi"><b>${unit(fmtV(mean(fvals), m))}</b><small>${esc(t("together.avgOf", { who }))}</small></div>
      <div class="tc-kpi"><b>${onTarget}<span class="u">/${doneKeys.length}</span></b><small>${esc(t(m === "protein" ? "together.proteinMet" : "together.onTarget"))}</small></div>
      <div class="tc-kpi"><b>${focus ? logged.length : reg.size}${focus ? "" : `<span class="u">/${people.length}</span>`}</b><small>${esc(t(focus ? "together.daysLogged" : "together.inAverage"))}</small></div>
    </div>`;

  // the list: legend, table view and picker in one; while a day is picked it shows that day
  const rowVal = (vals) => (atIdx !== null ? fmtV(vals[atIdx], m) : fmtV(mean(done(vals)), m));
  // a picked person's shape in their colour, everyone else an empty ring: the list and the day share it
  const markOf = (p) => {
    const si = st.picked.indexOf(p.owner);
    return si >= 0
      ? { color: `var(--tc-s${si + 1})`, html: `<svg width="16" height="16" aria-hidden="true">${shape(SHAPES[si], 8, 8, 5, `var(--tc-s${si + 1})`)}</svg>` }
      : { color: "var(--tc-sec)", html: `<svg width="16" height="16" aria-hidden="true"><circle cx="8" cy="8" r="5" fill="none" stroke="var(--tc-sec)" stroke-width="1.5"/></svg>` };
  };
  const meP = people.find((p) => p.owner === me);
  const listPeople = meP ? [meP, ...people.filter((p) => p !== meP)] : people;
  const rows = listPeople.map((p) => {
    const s = series.find((q) => q.p === p);
    const si = st.picked.indexOf(p.owner);
    const out = !reg.has(p.owner);
    const lg = done(s.vals).filter((v) => v !== null).length;
    const mk = markOf(p).html;
    return `<button type="button" class="tc-row${out ? " is-out" : ""}" data-pick="${esc(p.owner)}" aria-pressed="${si >= 0}">
      <span class="tc-mk">${mk}</span>
      <span class="tc-nm">${esc(p.name || p.owner)}${p.owner === me ? `<small>${esc(t("us.you"))}</small>` : ""}${out ? `<small>${esc(t("together.notInAvg"))}</small>` : ""}</span>
      <span class="tc-vl">${esc(rowVal(s.vals))}</span><span class="tc-lg">${lg}/${doneKeys.length}</span></button>`;
  }).join("");
  const atLabel = atIdx !== null ? (atIdx === todayIdx ? t("together.todaySoFar") : formatDate(ordered[atIdx].ts, { weekday: "short", month: "short", day: "numeric" })) : t("together.rangeAvg", { n });
  const avgRow = `<div class="tc-row is-avg"><span class="tc-mk"><svg width="16" height="16" aria-hidden="true"><rect x="1" y="7" width="14" height="2.5" rx="1.2" fill="var(--tc-ink)"/></svg></span>
    <span class="tc-nm">${esc(t("together.groupAvg"))}</span><span class="tc-vl">${esc(rowVal(av))}</span>
    <span class="tc-lg">${atIdx !== null ? (avgs[atIdx] ? esc(t("together.nIn", { n: avgs[atIdx].n })) : "–") : esc(t("together.logged"))}</span></div>`;

  let tip = "";
  if (st.scrub !== null) {
    const trows = [`<div class="tc-tr"><i style="background:var(--tc-ink)"></i><b>${esc(fmtV(av[atIdx], m))}</b><span>${esc(avgs[atIdx] ? t("together.avgOfN", { n: avgs[atIdx].n }) : t("together.avgShort"))}</span></div>`,
      ...st.picked.map((o, si) => { const s = series.find((q) => q.p.owner === o); return s ? `<div class="tc-tr"><i style="background:var(--tc-s${si + 1})"></i><b>${esc(fmtV(s.vals[atIdx], m))}</b><span>${esc(nameOf(s.p))}</span></div>` : ""; })].join("");
    const left = (x(atIdx) / W) * 100;
    tip = `<div class="tc-tip" style="${left > 55 ? `right:${(100 - left + 3).toFixed(1)}%` : `left:${(left + 3).toFixed(1)}%`}"><div class="tc-td">${esc(atLabel)}</div>${trows}</div>`;
  }

  const seg = (attr, cur, opts) => `<div class="tg-range tc-seg" role="group">${opts.map(([k, l]) => `<button type="button" data-${attr}="${k}" aria-pressed="${cur === k}">${esc(l)}</button>`).join("")}</div>`;
  return `
    <h2 class="tg-h2">${esc(t("together.title"))}</h2>
    <div class="us-card tc">
      ${seg("metric", m, [["pct", t("together.pct")], ["kcal", t("together.kcal")], ["protein", t("together.protein")]])}
      ${seg("view", st.view, [["everyone", t("together.everyone")], ["me", t("together.me")], ["avg", t("together.average")]])}
      ${kpis}
      <div class="tc-chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(t("together.title"))}">${g}</svg>${tip}</div>
      <p class="tc-rule">${esc(t(m === "protein" ? "together.ruleProtein" : "together.rule"))}</p>
      <div class="tc-list"><div class="tc-lh">${esc(atLabel)}</div>${avgRow}${rows}</div>
    </div>
    ${selectedDay && keys.includes(selectedDay) ? `<div class="tc-day">${dayDetail(selectedDay, markOf)}</div>` : ""}
    <p class="tg-note">${esc(t("together.hint"))}</p>`;
}

/** The chart's x geometry, shared by drawing and reading a finger's position. */
const GEO = { W: 337, L: 30, R: 52 };

/**
 * Draws the section into `sec` (an element that stays put) and handles everything in it with one
 * set of listeners, so a redraw mid-drag never loses the finger. Letting go of a drag opens that
 * day's details; letting go on the same day again closes them.
 */
export function mountTogether(sec, ctx) {
  const draw = () => { sec.innerHTML = togetherInner(ctx); };
  sec.addEventListener("click", (e) => {
    const b = e.target.closest("[data-metric],[data-view],[data-pick],[data-close-day]");
    if (!b) return;
    if (b.dataset.metric) st.metric = b.dataset.metric;
    else if (b.dataset.view) {
      st.view = b.dataset.view;
      if (st.view === "me") st.picked = [ctx.me];
      if (st.view === "avg") st.picked = [];
    } else if (b.dataset.pick) {
      const i = st.picked.indexOf(b.dataset.pick);
      if (i >= 0) st.picked.splice(i, 1);
      else { st.picked.push(b.dataset.pick); if (st.picked.length > MAX_PICKED) st.picked.shift(); }
      st.view = "everyone";
    } else ctx.selectedDay = null; // the day's close button
    draw();
  });
  const n = ctx.days.length;
  const idxAt = (e) => {
    const svg = sec.querySelector(".tc-chart svg");
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / Math.max(1, r.width)) * GEO.W;
    return Math.max(0, Math.min(n - 1, Math.round(((px - GEO.L) / (GEO.W - GEO.L - GEO.R)) * (n - 1))));
  };
  let dragging = false;
  sec.addEventListener("pointerdown", (e) => {
    if (!e.target.closest(".tc-chart svg")) return;
    dragging = true;
    sec.setPointerCapture?.(e.pointerId);
    st.scrub = idxAt(e);
    draw();
  });
  sec.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const i = idxAt(e);
    if (i !== st.scrub) { st.scrub = i; draw(); }
  });
  const end = (e) => {
    if (!dragging) return;
    dragging = false;
    const key = e.type === "pointerup" ? [...ctx.days].reverse()[st.scrub]?.key ?? null : null;
    st.scrub = null;
    if (key) ctx.selectedDay = ctx.selectedDay === key ? null : key;
    draw();
  };
  sec.addEventListener("pointerup", end);
  sec.addEventListener("pointercancel", end);
  draw();
}
