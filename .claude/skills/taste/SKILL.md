---
name: taste
description: SnapCal's design taste and review workflow. Use for ANY visual or UI change in this repo — new screens, restyles, colours, fonts, icons, the intro, charts, layout fixes, themes — and whenever the owner asks for a look, a mockup, "make it nicer", or "make it live". Covers the Mono (Nothing OS-inspired) aesthetic, when colour is allowed, contrast rules, what reads as "vibe-coded", iPhone layout checks, and the mockup-first → approve → ship flow.
---

# SnapCal taste

The owner has a clear eye. Follow this instead of generic "modern app" defaults.

## 1. Workflow: show, then ship

1. **Mockups first.** Before changing anything the owner will see, render mockups and send
   them as images (and the HTML if it's interactive). Use real data shapes and real copy,
   phone frames at iPhone size, and always put the current look next to the proposal.
   - Figma is connected, but the team is on the Starter plan and hits the MCP call limit
     fast. Default to an HTML mockup board screenshotted with Playwright (see `scripts/`).
   - When the choice is subjective (fonts, palettes, logo directions), show 2–4 options and
     say which you recommend and why.
2. **Build on the feature branch.** Screenshot the real app (not only mockups) in every
   theme before calling it done.
3. **Go live only on "make it live".** That means fast-forwarding `main` (production
   deploys from `main` on Vercel). Never push to `main` without it.

## 2. The look: Mono (default) and Classic

Mono is the default for everyone; Classic (the original warm, colourful look) must keep
working and stays selectable in Profile › Appearance. Every visual change is checked in
**Mono Light, Mono Dark and Classic**.

Mono, in the spirit of Nothing OS:
- Black and white. Page `#F2F2F2` / cards `#FFF` in light; `#000` / `#111` in dark.
- Dot-matrix numerals (Doto, self-hosted) for the numbers people come to read; everything
  else is the system sans. Small labels: quiet uppercase sans with light tracking.
- A faint dot grid behind the page, flat cards with 1px hairlines (no drop shadows, no
  tinted gradients), dotted rings for big progress rings, a dot under the active tab.
- Buttons and links are ink (black in light, white in dark), never blue.
- Tokens live in `css/mono.css` (`--mn-*`), mapped onto the app's `--sc-*` tokens. Style
  through tokens so light, dark and markers-off all follow; don't hard-code colours.

## 3. Colour is for markers only — and be smart about it

Colour carries meaning, never decoration. Allowed: protein / carbs / fat, water, the streak,
over-goal, and chart series that need telling apart. Everything else is ink.
- Colour goes on small things: dots, thin bars, ring arcs, a chart line. Not text, not
  big fills, not card backgrounds.
- Keep the meaning consistent everywhere (protein red, carbs amber, fat blue, water blue,
  streak orange, over = red).
- "Coloured markers" can be switched off → pure black and white. Nothing may rely on colour
  alone: pair it with a label, position or shape.

## 4. Contrast is non-negotiable

- Text ≥ 4.5:1 (large text ≥ 3:1). Markers and other meaningful graphics ≥ 3:1 against
  what they sit on. Compute it; don't eyeball it.
- The classic marker colours fail on white (carbs 2.2, streak 2.2, water 2.8), so Mono Light
  uses deeper shades of the same hues; on black the originals pass and are kept.
- Secondary text is `#6E6E73` on white (5.1:1), `#9A9A9A` on black (7.5:1). The old
  `#8E8E93` fails on white; don't reintroduce it for text.
- `tests/theme.test.mjs` checks the Mono Light marker ratios. Extend it when adding a marker.

## 5. What reads as "vibe-coded" (avoid)

- Widely letter-spaced uppercase **monospace** taglines ("S N A P · L O G").
- A generic bold system-font wordmark with tight negative tracking as the "logo".
- Gradient-tinted cards, glassy blobs, purple-to-pink gradients, glows, emoji as decoration.
- Template-looking output (Canva-style logos, stock illustration).
- Adding words where a mark or a number would do. The intro has **no text**: just the
  pearl Fluid flow and the flame.

## 6. Brand

- The logo is the **flame** from the app icon (vector in `index.html`'s `.intro-flame`).
- Intro: pearl Fluid background (paper tones, zoom 2.4, low grain, `js/intro.js`), flame
  only, fades into the app.
- Home has no header row; the Profile avatar ends the week row, and the streak sits in the
  calorie card.

## 7. iPhone layout

- Check 375×667 (SE), 393×852 (15) and ≤360 widths. Nothing may overflow, clip or crowd;
  labels ellipsize instead of spilling; left and right halves of the tab bar mirror.
- Respect safe areas (`env(safe-area-inset-*)`) now that there's no header.
- Wider fonts (Doto) change fit: re-check number widths after any type change.

## 8. Practicalities

- CSP is `'self'` only: fonts, scripts and images must be vendored (see `vendor/`), with
  their licence alongside. Add new static files to `APP_SHELL` in `sw.js` and bump
  `CACHE_VERSION`.
- New user-facing strings go in both `i18n/en.json` and `i18n/es.json`.
- `scripts/qa.cjs` screenshots every tab in each theme with seeded data and mocked auth
  against `PORT=3100 node dev-server.mjs`; `scripts/sheet.cjs` tiles screenshots into one
  image for review. Read the header of each script for usage.
