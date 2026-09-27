// sheet.cjs — tile screenshots side by side into one review image (captions = file names).
//   node .claude/skills/taste/scripts/sheet.cjs out.png a.png b.png c.png ...
const { chromium } = require(require("child_process").execSync("npm root -g").toString().trim() + "/playwright");
const fs = require("fs");
(async () => {
  const [out, ...files] = process.argv.slice(2);
  if (!out || !files.length) { console.error("usage: sheet.cjs out.png img1.png img2.png ..."); process.exit(1); }
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1500, height: 900 } });
  const figs = files.map((f) => `<figure style="margin:0"><img src="data:image/png;base64,${fs.readFileSync(f).toString("base64")}" style="width:360px;display:block;border:1px solid #ccc"><figcaption style="font:12px sans-serif">${f.split("/").pop()}</figcaption></figure>`).join("");
  await p.setContent(`<body style="margin:8px;display:flex;gap:10px;flex-wrap:wrap">${figs}</body>`);
  await p.screenshot({ path: out, fullPage: true });
  await b.close();
})();
