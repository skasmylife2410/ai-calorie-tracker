// qa.cjs — screenshot SnapCal's tabs in each theme at iPhone size, with seeded data and
// mocked auth, so a visual change can be checked everywhere before it ships.
//
//   PORT=3100 node dev-server.mjs &            (from the repo root)
//   node .claude/skills/taste/scripts/qa.cjs   → writes qa-<theme>-<screen>.png to OUT
//
// Env: THEMES=mono-light,mono-dark,classic  SHOTS=home,us,shared,progress,profile,fab
//      W=393 H=852  BASE=http://localhost:3100  OUT=<dir, default: cwd>
// Uses the globally installed Playwright (npm root -g) and its bundled Chromium.
const { chromium, devices } = require(require("child_process").execSync("npm root -g").toString().trim() + "/playwright");
const themes = (process.env.THEMES || "mono-light,mono-dark,classic").split(",");
const shots = (process.env.SHOTS || "home,us,shared,progress,profile,fab").split(",");
const W = +(process.env.W || 393), H = +(process.env.H || 852);
const BASE = process.env.BASE || "http://localhost:3100";
const OUT = process.env.OUT || process.cwd();

function seed([theme]) {
  try {
    sessionStorage.setItem("snapcal.justUpdated", "1"); // skip the intro
    localStorage.setItem("snapcal.apiToken", "x");
    if (localStorage.getItem("__seeded")) return;
    const D = 864e5, day0 = new Date(); day0.setHours(0, 0, 0, 0);
    localStorage.setItem("snapcal.userProfile", JSON.stringify({ displayName: "Sam", sex: "male", age: 30, heightCm: 178, weightKg: 78, activityLevel: "moderate", targetDeltaKcal: -400, theme, updatedAt: 1 }));
    const meals = []; let id = 0;
    const add = (name, kcal, p, c, f, t) => meals.push({ id: "m" + id++, name, calories: kcal, proteinG: p, carbsG: c, fatG: f, timestamp: t, source: "manual" });
    for (let d = 13; d >= 0; d--) {
      if (d === 3 || d === 9) continue; // a couple of missed days
      const base = day0.getTime() - d * D, k = d === 0 ? 1 : 0.85 + ((d * 37) % 30) / 100;
      add("Oats & berries", Math.round(420 * k), 18, 62, 9, base + 8.2 * 36e5);
      add("Chicken rice bowl", Math.round(690 * k), 52, 70, 18, base + 13.4 * 36e5);
      add("Greek yogurt", Math.round(180 * k), 28, 8, 17, base + 16.6 * 36e5);
      if (d > 0) add("Salmon & greens", Math.round(640 * k), 42, 30, 30, base + 19.5 * 36e5);
    }
    localStorage.setItem("snapcal.foodEntries", JSON.stringify(meals));
    const w = [];
    for (let d = 28; d >= 0; d -= 2) {
      const t = day0.getTime() - d * D + 7 * 36e5;
      w.push({ id: "w" + d, day: new Date(t).toISOString().slice(0, 10), kg: Math.round((78.6 - (28 - d) * 0.06 + ((d * 13) % 5) / 20) * 10) / 10, timestamp: t });
    }
    localStorage.setItem("snapcal.weightEntries", JSON.stringify(w));
    localStorage.setItem("__seeded", "1");
  } catch { /* private mode */ }
}

(async () => {
  const b = await chromium.launch();
  for (const theme of themes) {
    const c = await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: devices["iPhone 13"].userAgent });
    await c.addInitScript(seed, [theme]);
    await c.route("**/api/auth*", (r) => r.fulfill({ json: { ok: true, username: "sam", needsConsent: false } }));
    await c.route("**/api/sync*", (r) => r.fulfill({ json: { ok: true } }));
    await c.route("**/api/social*", (r) => r.fulfill({ json: { ok: true, items: [] } }));
    const p = await c.newPage();
    p.on("pageerror", (e) => console.log(theme, "page error:", e.message));
    await p.goto(BASE + "/", { waitUntil: "commit" });
    await p.waitForTimeout(3500);
    const tab = async (id) => { await p.click(`.tab-btn[data-tab="${id}"]`); await p.waitForTimeout(1300); };
    for (const s of shots) {
      if (s === "home") await tab("home");
      if (s === "us") await tab("us");
      if (s === "shared") await tab("shared");
      if (s === "progress") await tab("weight");
      if (s === "profile") {
        await tab("home"); await p.click("#home-avatar"); await p.waitForTimeout(1200);
        await p.evaluate(() => document.querySelector(".theme-row")?.scrollIntoView({ block: "center" }));
        await p.waitForTimeout(400);
      }
      if (s === "fab") { await tab("home"); await p.click("#fab-btn"); await p.waitForTimeout(900); }
      await p.screenshot({ path: `${OUT}/qa-${theme}-${s}.png` });
      if (s === "fab") { await p.click("#fab-btn").catch(() => {}); await p.waitForTimeout(500); }
      if (s === "profile") { await p.reload({ waitUntil: "commit" }); await p.waitForTimeout(3000); }
    }
    await c.close();
  }
  await b.close();
})();
