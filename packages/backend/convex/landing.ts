/**
 * trycommons.app — the marketing page, served from the Convex site at "/".
 *
 * Light Unified Craft: paper and ink with the brand's burnt-orange accent
 * doing all the interactive work (links, primary buttons, eyebrows, markers),
 * an editorial serif on every heading, and dark product imagery inset into
 * the page. The paper frames the work the way a gallery wall frames a
 * picture, and it proves the token set holds up in both directions.
 *
 * Redesign (2026-09-11): a best-in-class visual pass. Same claims, tighter
 * hierarchy — hero, works-with, the shift, a scannable three-pillar bento,
 * deep-dive rows, how it works, who it's for, FAQ, a dark closing band — and
 * one primary call to action repeated where decisions happen. Display type is
 * a real editorial serif (Instrument Serif, a Canela-class stand-in) with
 * Inter for interface copy; both swap in over system fallbacks so first paint
 * never waits on a font. Editorial surfaces carry the brand's paper grain.
 *
 * The product shots are deliberate wireframe placeholders (`.wf`): a dark
 * app frame with skeleton content and a small "screenshot" tag, so they read
 * as intentional and are trivially swapped for real captures by replacing a
 * .wf block with an <img>.
 */

const APP_URL = "/app";
// Stable URL, resolved per request against the published release (see the
// /download route). Never hard-code a versioned artifact here: the filename
// changes every release, and updating this by hand is a step that gets missed.
const DOWNLOAD_URL = "/download";

// Paper grain (brand §7): fine SVG noise, tiled and screened at low opacity
// on editorial surfaces only. Inline so the page stays a single request.
const GRAIN =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.55 0'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)'/%3E%3C/svg%3E";

export function landingHtml(version?: string): string {
  const buildLabel = version ? `v${version} · Apple silicon` : "Apple silicon";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Commons: design on the product, not pictures of it</title>
<meta name="description" content="Commons puts your running app on a shared canvas. Comment on the real product, hand feedback to a coding agent, and keep the reasoning attached to the work." />
<meta property="og:title" content="Commons: design on the product, not pictures of it" />
<meta property="og:description" content="One canvas for the team, showing the app that actually runs. Comment on real screens, turn feedback into drafts, keep the why with receipts." />
<meta property="og:type" content="website" />
<meta property="og:url" content="https://trycommons.app" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="theme-color" content="#f3f0e8" />
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%231a1b17'/%3E%3Cpath d='M21.5 11.5a6 6 0 1 0 0 9' fill='none' stroke='%2345a898' stroke-width='3' stroke-linecap='round'/%3E%3C/svg%3E" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter:wght@400;500;600&display=swap" />
<style>
  :root {
    --paper: #f3f0e8;
    --panel: #fbf9f4;
    --raised: #f6f3ec;
    --sand-deep: #eae6dc;
    --line: #e6e2d6;
    --line-mid: #d8d3c4;
    --line-strong: #beb8a5;
    --ink: #26251e;
    --ink-2: #5c5a4f;
    --ink-3: #8f8d80;
    --accent: #9c531f;
    --accent-hover: #874618;
    --accent-soft: rgba(156, 83, 31, 0.1);
    --accent-ring: rgba(156, 83, 31, 0.28);
    --accent-glow: rgba(200, 116, 63, 0.32);
    --bronze: #a8712c;
    --dark: #1a1b17;
    --dark-panel: #21221d;
    --dark-raised: #272822;
    --dark-line: #2a2b24;
    --dark-line-2: #363730;
    --dark-line-3: #46473d;
    --dark-ink: #edebe0;
    --dark-ink-2: #a3a195;
    --dark-ink-3: #716f64;
    --teal: #45a898;
    --orange: #c8743f;
    --serif: "Instrument Serif", "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif;
    --sans: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    --mono: ui-monospace, SFMono-Regular, Menlo, monospace;
    /* Raised-surface material: ambient + key + a hairline of sky caught on
       the top edge. One recipe everywhere, which is what makes it a material
       rather than a set of drop shadows. All shadows are warm-tinted. */
    --shadow-sm: 0 1px 2px rgba(50, 45, 25, 0.05), 0 6px 18px rgba(50, 45, 25, 0.06);
    --shadow: 0 1px 2px rgba(50, 45, 25, 0.05), 0 10px 28px rgba(50, 45, 25, 0.07), 0 28px 56px rgba(50, 45, 25, 0.07);
    --shadow-lg: 0 2px 4px rgba(50, 45, 25, 0.06), 0 24px 48px rgba(50, 45, 25, 0.1), 0 72px 140px rgba(50, 45, 25, 0.14);
    --shot-highlight: inset 0 1px 0 rgba(255, 255, 255, 0.08);
    --ease: cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; }
  body {
    margin: 0; background: var(--paper); color: var(--ink);
    font: 17px/1.6 var(--sans); -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility; font-feature-settings: "cv11", "ss01";
    overflow-x: clip;
  }
  ::selection { background: var(--accent-soft); color: var(--ink); }
  .wrap { max-width: 1160px; margin: 0 auto; padding: 0 28px; }
  a { color: var(--accent); }
  :focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; border-radius: 6px; }

  /* Rules between sections fade at both ends: a hairline that starts and
     stops feels drawn; one that runs edge-to-edge feels like a table. */
  .rule { height: 1px; border: 0; margin: 0;
          background: linear-gradient(90deg, transparent, var(--line-mid) 18%, var(--line-mid) 82%, transparent); }

  /* ── Nav ─────────────────────────────────────────────── */
  nav {
    position: sticky; top: 0; z-index: 20;
    background: rgba(243, 240, 232, 0.78);
    backdrop-filter: saturate(160%) blur(16px);
    -webkit-backdrop-filter: saturate(160%) blur(16px);
    border-bottom: 1px solid transparent;
    transition: border-color 220ms var(--ease), box-shadow 220ms var(--ease);
  }
  nav.stuck { border-bottom-color: var(--line); box-shadow: 0 6px 24px rgba(50, 45, 25, 0.05); }
  nav .wrap { display: flex; align-items: center; gap: 24px; height: 68px; }
  .brand { font-family: var(--serif); font-size: 24px; letter-spacing: -0.005em;
           color: var(--ink); text-decoration: none; display: flex; align-items: center; gap: 10px; }
  .brand svg { display: block; }
  nav .links { display: flex; gap: 2px; margin-left: auto; }
  nav .links a {
    color: var(--ink-2); text-decoration: none; font-size: 14.5px; font-weight: 500;
    padding: 8px 12px; border-radius: 8px; transition: color 140ms var(--ease), background 140ms var(--ease);
  }
  nav .links a:hover { color: var(--ink); background: rgba(38, 37, 30, 0.05); }

  /* ── Buttons ─────────────────────────────────────────── */
  .btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 9px;
    font: inherit; font-size: 15px; font-weight: 500; text-decoration: none; white-space: nowrap;
    padding: 10px 18px; border-radius: 10px; border: 1px solid transparent; cursor: pointer;
    transition: background 160ms var(--ease), border-color 160ms var(--ease), transform 200ms var(--ease), box-shadow 200ms var(--ease);
  }
  .btn:active { transform: translateY(0) scale(0.985); }
  .btn svg { flex-shrink: 0; transition: transform 200ms var(--ease); }
  .btn.primary {
    background: var(--accent); color: #fff;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.16), 0 1px 2px rgba(135, 70, 24, 0.35);
  }
  .btn.primary:hover { background: var(--accent-hover); transform: translateY(-1px);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.16), 0 4px 12px rgba(135, 70, 24, 0.3); }
  .btn.primary:hover svg { transform: translateX(3px); }
  .btn.ghost { background: var(--panel); color: var(--ink); border-color: var(--line-mid); box-shadow: var(--shadow-sm); }
  .btn.ghost:hover { background: var(--raised); border-color: var(--line-strong); transform: translateY(-1px); }
  .btn.lg { padding: 15px 26px; font-size: 16.5px; border-radius: 12px; }
  .btn.lg.primary {
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.16), 0 2px 6px rgba(135, 70, 24, 0.3), 0 14px 32px var(--accent-glow);
  }
  .btn.lg.primary:hover {
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.16), 0 4px 10px rgba(135, 70, 24, 0.32), 0 20px 44px var(--accent-glow);
  }

  /* ── Type ────────────────────────────────────────────── */
  section { padding: 120px 0; }
  .eyebrow { font-size: 12.5px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase;
             color: var(--accent); margin: 0 0 18px; display: inline-flex; align-items: center; gap: 10px; }
  .eyebrow::before { content: ""; width: 18px; height: 1px; background: var(--accent); opacity: 0.6; }
  .center .eyebrow::before { display: none; }
  h1, h2, h3.serif { font-family: var(--serif); font-weight: 400; letter-spacing: -0.015em; text-wrap: balance; }
  h1 { font-size: clamp(46px, 7.2vw, 92px); line-height: 0.98; margin: 0 0 26px; letter-spacing: -0.02em; }
  h1 em, h2 em { font-style: italic; color: var(--accent); }
  h2 { font-size: clamp(34px, 4.4vw, 54px); line-height: 1.04; margin: 0 0 18px; }
  h3 { font-size: 19px; line-height: 1.35; margin: 0 0 8px; font-weight: 600; letter-spacing: -0.01em; }
  .lede { font-size: clamp(18px, 2.1vw, 21px); line-height: 1.55; color: var(--ink-2); margin: 0 0 34px; max-width: 54ch; text-wrap: pretty; }
  .center { text-align: center; }
  .center .lede { margin-left: auto; margin-right: auto; }

  /* Editorial surfaces carry the brand's paper grain (§7). Screened at low
     opacity so it reads as material, never as noise. */
  .grain { position: relative; }
  .grain::after {
    content: ""; position: absolute; inset: 0; pointer-events: none;
    background-image: url("${GRAIN}"); background-size: 160px 160px;
    opacity: 0.045; mix-blend-mode: multiply;
  }

  /* ── Hero ────────────────────────────────────────────── */
  .hero { padding: 92px 0 0; text-align: center; position: relative; }
  .hero > .wrap { position: relative; z-index: 1; }
  .hero::before {
    /* A pool of warm light rising behind the headline, so the page opens
       lit rather than flat. */
    content: ""; position: absolute; left: 50%; top: -120px; width: 1100px; height: 640px;
    transform: translateX(-50%); pointer-events: none;
    background: radial-gradient(ellipse 50% 50% at 50% 40%, rgba(200, 116, 63, 0.14), rgba(69, 168, 152, 0.05) 55%, transparent 72%);
  }
  .badge {
    display: inline-flex; align-items: center; gap: 9px; margin-bottom: 30px;
    padding: 7px 14px 7px 9px; border: 1px solid var(--line-mid); border-radius: 999px;
    background: var(--panel); box-shadow: var(--shadow-sm);
    font-size: 13.5px; font-weight: 500; color: var(--ink-2);
  }
  .badge b { color: var(--accent); font-weight: 600; }
  .badge .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent);
                box-shadow: 0 0 0 4px var(--accent-soft); }
  .hero h1 { max-width: 16ch; margin-left: auto; margin-right: auto; }
  .hero .lede { margin: 0 auto 38px; max-width: 58ch; }
  .cta-row { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: center; }
  .fine { margin: 20px 0 0; font-size: 14px; color: var(--ink-3); display: flex; flex-wrap: wrap; gap: 6px 0; justify-content: center; }
  .fine span + span::before { content: "·"; margin: 0 10px; color: var(--line-strong); }

  /* The stage: the product sits in a pool of its own light. A dark shot
     dropped straight onto paper reads pasted-on; lit from behind it reads
     placed. */
  .stage { position: relative; margin-top: 76px; padding-bottom: 110px; }
  .stage::before {
    content: ""; position: absolute; inset: -6% -14% 0;
    background: radial-gradient(ellipse 60% 52% at 50% 44%, rgba(200, 116, 63, 0.2), rgba(69, 168, 152, 0.06) 56%, transparent 74%);
    pointer-events: none;
  }
  .stage .wf { position: relative; }

  /* ── Works-with strip ────────────────────────────────── */
  .with { padding: 30px 0 34px; }
  .with .wrap { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 14px 34px; }
  .with .label { font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--ink-3); margin-right: 6px; }
  .with .name { font-size: 15px; font-weight: 500; color: var(--ink-3); letter-spacing: -0.005em; transition: color 160ms var(--ease); }
  .with .name:hover { color: var(--ink); }

  /* ── The shift ───────────────────────────────────────── */
  .shift { padding: 130px 0 120px; }
  .shift h2 { font-size: clamp(36px, 5.2vw, 66px); max-width: 20ch; margin: 0 auto 22px; }
  .shift .lede { max-width: 56ch; margin-bottom: 0; font-size: clamp(18px, 2vw, 20px); }

  /* ── Pillars bento ───────────────────────────────────── */
  .pillars { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin-top: 56px; }
  .pillar {
    background: var(--panel); border: 1px solid var(--line); border-radius: 20px; overflow: hidden;
    box-shadow: var(--shadow-sm); text-align: left; display: flex; flex-direction: column;
    transition: transform 240ms var(--ease), box-shadow 240ms var(--ease), border-color 240ms var(--ease);
  }
  .pillar:hover { transform: translateY(-4px); box-shadow: var(--shadow); border-color: var(--line-strong); }
  .pillar .thumb { padding: 22px 22px 0; background: linear-gradient(180deg, var(--sand-deep), var(--panel)); }
  .pillar .thumb .wf { border-radius: 12px 12px 0 0; border-bottom: 0; box-shadow: var(--shot-highlight), 0 -8px 28px rgba(50, 45, 25, 0.08); }
  .pillar .body { padding: 24px 26px 28px; }
  .pillar h3.serif { font-size: 26px; margin: 0 0 8px; line-height: 1.12; }
  .pillar p { margin: 0; color: var(--ink-2); font-size: 15.5px; text-wrap: pretty; }
  .pillar .k { display: inline-block; margin-bottom: 14px; font-size: 12px; font-weight: 600;
               letter-spacing: 0.1em; text-transform: uppercase; color: var(--accent); }

  /* ── Feature rows ────────────────────────────────────── */
  .row { display: grid; grid-template-columns: 1fr 1.18fr; gap: 80px; align-items: center; }
  .row + .row { margin-top: 150px; }
  .row.flip .copy { order: 2; }
  .row h2 { font-size: clamp(30px, 3.4vw, 42px); }
  .row p { color: var(--ink-2); margin: 0 0 14px; text-wrap: pretty; }
  .row ul { margin: 22px 0 0; padding: 0; list-style: none; }
  .row li { position: relative; padding-left: 28px; margin-bottom: 11px; color: var(--ink-2); font-size: 16px; }
  .row li::before {
    content: ""; position: absolute; left: 1px; top: 7px; width: 13px; height: 13px;
    border-radius: 50%; background: var(--accent-soft);
    box-shadow: inset 0 0 0 1px var(--accent-ring);
  }
  .row li::after {
    content: ""; position: absolute; left: 5.5px; top: 11.5px; width: 4px; height: 4px;
    border-radius: 50%; background: var(--accent);
  }

  /* Mid-page break: a quiet second door, between the story and the mechanics. */
  .break { padding: 0 0 8px; }
  .break .inner {
    display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 18px;
    padding: 30px 34px; border: 1px solid var(--line-mid); border-radius: 20px; background: var(--panel);
    box-shadow: var(--shadow-sm);
  }
  .break .inner .t { font-family: var(--serif); font-size: 26px; letter-spacing: -0.01em; margin: 0; }
  .break .inner .s { margin: 4px 0 0; color: var(--ink-3); font-size: 14.5px; }

  /* ── Steps ───────────────────────────────────────────── */
  .cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin-top: 56px; counter-reset: step; }
  .card {
    background: var(--panel); border: 1px solid var(--line); border-radius: 20px; padding: 32px 30px 28px;
    box-shadow: var(--shadow-sm); position: relative;
  }
  .card::before {
    counter-increment: step; content: counter(step, decimal-leading-zero);
    display: block; font-family: var(--serif); font-size: 56px; line-height: 1;
    color: var(--accent); opacity: 0.34; margin-bottom: 20px; letter-spacing: -0.02em;
  }
  .card p { margin: 0; color: var(--ink-2); font-size: 15.5px; text-wrap: pretty; }

  .band { background: var(--panel); border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }

  /* ── Roles ───────────────────────────────────────────── */
  .tiers { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin-top: 56px; }
  .tier {
    border: 1px solid var(--line-mid); border-radius: 20px; padding: 30px 28px; background: var(--panel);
    box-shadow: var(--shadow-sm); text-align: left;
    transition: transform 240ms var(--ease), box-shadow 240ms var(--ease), border-color 240ms var(--ease);
  }
  .tier:hover { transform: translateY(-4px); box-shadow: var(--shadow); border-color: var(--line-strong); }
  .tier .who { font-family: var(--serif); font-size: 28px; letter-spacing: -0.01em; margin-bottom: 6px; line-height: 1.1; }
  .tier .how { font-size: 14.5px; color: var(--accent); font-weight: 500; margin-bottom: 18px; }
  .tier ul { margin: 0; padding: 0; list-style: none; }
  .tier li { position: relative; padding-left: 20px; margin-bottom: 10px; color: var(--ink-2); font-size: 15px; }
  .tier li::before { content: ""; position: absolute; left: 2px; top: 9px; width: 5px; height: 5px;
                     border-radius: 50%; background: var(--accent); opacity: 0.7; }

  /* ── Access: a lighter rhythm than the card grids above it ─ */
  .access-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0; margin-top: 52px;
                 border-top: 1px solid var(--line-mid); }
  .access { padding: 30px 28px 8px; border-right: 1px solid var(--line); }
  .access:last-child { border-right: 0; }
  .access .who { font-family: var(--serif); font-size: 26px; margin-bottom: 4px; line-height: 1.1; }
  .access .how { font-size: 14px; color: var(--accent); font-weight: 500; margin-bottom: 14px; }
  .access ul { margin: 0; padding: 0; list-style: none; }
  .access li { color: var(--ink-2); font-size: 15px; margin-bottom: 8px; }

  /* ── FAQ ─────────────────────────────────────────────── */
  .faq { max-width: 800px; margin: 48px auto 0; }
  details { border-bottom: 1px solid var(--line); }
  summary { cursor: pointer; font-weight: 500; font-size: 18px; list-style: none;
            display: flex; gap: 14px; align-items: baseline; padding: 22px 4px;
            transition: color 140ms var(--ease); }
  summary:hover { color: var(--accent-hover); }
  summary::-webkit-details-marker { display: none; }
  summary::after { content: "+"; margin-left: auto; color: var(--ink-3); font-weight: 300;
                   font-size: 24px; line-height: 1; transition: transform 240ms var(--ease); }
  details[open] summary::after { transform: rotate(45deg); }
  details p { color: var(--ink-2); margin: 0 4px 22px; font-size: 16px; max-width: 64ch; text-wrap: pretty; }

  /* ── Closing CTA + footer ────────────────────────────── */
  .close-cta {
    position: relative; overflow: hidden;
    background: var(--dark); color: var(--dark-ink); border: 1px solid var(--dark-line-3);
    border-radius: 28px; padding: 96px 40px; text-align: center; box-shadow: var(--shadow-lg);
  }
  .close-cta::before {
    /* The app's own canvas: dot grid with a warm pool of light, the same
       figure/ground the product uses. */
    content: ""; position: absolute; inset: 0;
    background-image: radial-gradient(circle, #34352d 1.1px, transparent 1.1px);
    background-size: 22px 22px;
    -webkit-mask-image: radial-gradient(ellipse 70% 80% at 50% 50%, #000 40%, transparent 100%);
            mask-image: radial-gradient(ellipse 70% 80% at 50% 50%, #000 40%, transparent 100%);
  }
  .close-cta::after {
    content: ""; position: absolute; inset: 0;
    background: radial-gradient(ellipse 56% 62% at 50% 108%, rgba(200, 116, 63, 0.22), transparent 70%);
  }
  .close-cta > * { position: relative; z-index: 1; }
  .close-cta h2 { color: var(--dark-ink); font-size: clamp(38px, 5vw, 62px); }
  .close-cta p { color: var(--dark-ink-2); max-width: 48ch; margin: 0 auto 36px; font-size: 18px; }
  .close-cta .btn.ghost { background: transparent; color: var(--dark-ink); border-color: var(--dark-line-3); box-shadow: none; }
  .close-cta .btn.ghost:hover { background: rgba(255, 255, 255, 0.06); border-color: var(--dark-ink-3); }
  .close-cta .fine { color: var(--dark-ink-3); }
  .close-cta .fine span + span::before { color: var(--dark-line-3); }

  footer { padding: 64px 0 64px; color: var(--ink-3); font-size: 14.5px; }
  footer .top { display: flex; flex-wrap: wrap; gap: 32px 72px; align-items: flex-start; }
  footer .brandcol { max-width: 320px; }
  footer .brandcol .brand { margin-bottom: 12px; }
  footer .tagline { margin: 0; color: var(--ink-3); font-size: 14.5px; line-height: 1.55; text-wrap: pretty; }
  footer .col { display: flex; flex-direction: column; gap: 10px; min-width: 140px; }
  footer .col .h { font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--ink-3); margin-bottom: 4px; }
  footer a { color: var(--ink-2); text-decoration: none; transition: color 140ms var(--ease); }
  footer a:hover { color: var(--ink); }
  footer .meta { display: flex; flex-wrap: wrap; gap: 16px; margin-top: 44px; padding-top: 24px;
                 border-top: 1px solid var(--line); font-size: 13.5px; }
  footer .meta .sp { margin-left: auto; }

  /* ── Wireframe placeholders (swap for real screenshots) ─
     A dark app frame with skeleton content. The tag makes it obviously a
     stand-in; replace any .wf block with an <img> when captures exist. */
  .wf {
    position: relative; background: var(--dark); border: 1px solid var(--dark-line-3); border-radius: 16px;
    box-shadow: var(--shot-highlight), var(--shadow); overflow: hidden; color: var(--dark-ink);
    font-size: 12px; line-height: 1.4;
  }
  .wf.big { border-radius: 22px; box-shadow: var(--shot-highlight), var(--shadow-lg); }
  .wf .tag {
    position: absolute; right: 12px; bottom: 12px; z-index: 2;
    padding: 4px 9px; border-radius: 999px; border: 1px dashed var(--dark-line-3);
    background: rgba(26, 27, 23, 0.7); color: var(--dark-ink-3); font-size: 10.5px; letter-spacing: 0.06em;
    text-transform: uppercase; font-weight: 500; backdrop-filter: blur(4px);
  }
  .w-bar { display: flex; align-items: center; gap: 10px; padding: 11px 14px; border-bottom: 1px solid var(--dark-line); }
  .w-lights { display: flex; gap: 6px; }
  .w-lights i { width: 10px; height: 10px; border-radius: 50%; background: var(--dark-line-3); display: block; }
  .w-tab { padding: 4px 12px; border-radius: 7px; color: var(--dark-ink-3); font-size: 11.5px; }
  .w-tab.on { background: var(--dark-raised); color: var(--dark-ink); }
  .w-sub { display: flex; align-items: center; gap: 10px; padding: 8px 14px; border-bottom: 1px solid var(--dark-line); }
  .w-seg { display: flex; border: 1px solid var(--dark-line-2); border-radius: 7px; overflow: hidden; }
  .w-seg span { padding: 3px 10px; font-size: 11px; color: var(--dark-ink-3); }
  .w-seg span.on { background: var(--dark-raised); color: var(--dark-ink); }
  .w-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--teal); box-shadow: 0 0 0 3px rgba(69, 168, 152, 0.18); }
  .w-spacer { margin-left: auto; }
  .w-pill { padding: 3px 10px; border: 1px solid var(--dark-line-2); border-radius: 999px; font-size: 11px; color: var(--dark-ink-2); }
  .w-canvas {
    position: relative; padding: 28px; min-height: 320px;
    background-image: radial-gradient(circle, #34352d 1.1px, transparent 1.1px);
    background-size: 22px 22px;
  }
  .w-frames { display: flex; gap: 22px; align-items: flex-start; }
  .w-frame { flex: 1; background: var(--dark-panel); border: 1px solid var(--dark-line-2); border-radius: 10px; overflow: hidden; }
  .w-frame-head { display: flex; gap: 7px; align-items: center; padding: 7px 10px; border-bottom: 1px solid var(--dark-line);
                  font-size: 10.5px; color: var(--dark-ink-2); }
  .w-frame-head b { color: var(--dark-ink); font-weight: 600; }
  .w-frame-head .rt { color: var(--dark-ink-3); font-family: var(--mono); font-size: 9.5px; }
  .w-body { padding: 12px; display: grid; gap: 8px; }
  /* Wireframe skeleton: outlined, dashed, obviously a stand-in. */
  .w-l { height: 8px; border-radius: 4px; background: #2e2f28; }
  .w-l.w70 { width: 70%; } .w-l.w50 { width: 50%; } .w-l.w85 { width: 85%; } .w-l.w40 { width: 40%; } .w-l.w30 { width: 30%; }
  .w-l.accent { background: rgba(200, 116, 63, 0.5); }
  .w-box { border: 1px dashed var(--dark-line-3); border-radius: 7px; background: rgba(255, 255, 255, 0.015); position: relative; }
  .w-box.h46 { height: 46px; } .w-box.h72 { height: 72px; } .w-box.h110 { height: 110px; }
  .w-box::before, .w-box::after {
    content: ""; position: absolute; left: 8px; right: 8px; top: 50%; height: 1px;
    background: var(--dark-line-2); transform: rotate(16deg); opacity: 0.7;
  }
  .w-box::after { transform: rotate(-16deg); }
  .w-btn { height: 24px; width: 104px; border-radius: 999px; background: var(--orange); opacity: 0.9; }
  .w-pin {
    position: absolute; width: 24px; height: 24px; border-radius: 12px 12px 12px 3px;
    background: var(--bronze); color: #1a1b17; font-size: 10px; font-weight: 700;
    display: flex; align-items: center; justify-content: center;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.45), 0 0 0 2px rgba(26, 27, 23, 0.6);
  }
  .w-note {
    background: var(--dark-panel); border: 1px solid var(--dark-line-2);
    border-left: 3px solid var(--orange); border-radius: 8px; padding: 10px 12px;
    color: var(--dark-ink-2); font-size: 11px; line-height: 1.45; margin-top: 12px;
  }
  .w-note .cite { display: inline-block; margin-top: 6px; margin-right: 5px; padding: 1px 7px;
                  border: 1px solid var(--dark-line-3); border-radius: 999px; font-size: 9.5px; color: var(--dark-ink-3); }
  .w-note .cite.inf { border-style: dashed; border-color: #8a6d2f; color: #d9a03f; }
  .w-panel { padding: 14px; display: grid; gap: 10px; }
  .w-msg { background: var(--dark-panel); border: 1px solid var(--dark-line-2); border-radius: 9px; padding: 10px 12px; }
  .w-who { font-size: 11px; font-weight: 600; color: var(--bronze); margin-bottom: 5px; }
  .w-txt { color: var(--dark-ink-2); font-size: 11.5px; }
  .w-run { display: flex; align-items: center; gap: 8px; font-size: 11px; color: var(--dark-ink-3); font-family: var(--mono); }
  .w-run .tick { color: var(--teal); }
  .w-cta { display: inline-flex; align-items: center; gap: 6px; padding: 5px 12px; border-radius: 8px;
           background: var(--orange); color: #1a1b17; font-size: 11.5px; font-weight: 600; }
  .w-row { display: flex; align-items: center; gap: 10px; padding: 9px 0; border-bottom: 1px solid var(--dark-line); font-size: 11.5px; }
  .w-row:last-child { border-bottom: none; }
  .w-row .pct { margin-left: auto; color: var(--teal); font-weight: 600; }
  .w-row .pct.low { color: #d9a03f; }
  .w-heat { position: relative; height: 96px; border-radius: 8px; background: var(--dark-raised); overflow: hidden;
            border: 1px dashed var(--dark-line-3); }
  .w-heat i { position: absolute; width: 10px; height: 10px; border-radius: 50%; background: rgba(217, 160, 63, 0.85);
              box-shadow: 0 0 12px rgba(217, 160, 63, 0.5); }
  .w-avatars { display: flex; }
  .w-avatars i { width: 20px; height: 20px; border-radius: 50%; border: 2px solid var(--dark); margin-left: -6px; display: block; }
  .w-mini { padding: 14px; display: grid; gap: 8px; }

  /* ── Motion (respectful) ─────────────────────────────── */
  .reveal { opacity: 0; transform: translateY(18px); transition: opacity 700ms var(--ease), transform 700ms var(--ease); }
  .reveal.in { opacity: 1; transform: none; }
  .reveal .tier, .reveal .card, .reveal .pillar, .reveal .access { opacity: 0; transform: translateY(12px);
    transition: opacity 560ms var(--ease), transform 560ms var(--ease); }
  .reveal.in .tier, .reveal.in .card, .reveal.in .pillar, .reveal.in .access { opacity: 1; transform: none; }
  .reveal.in > :nth-child(2) { transition-delay: 80ms; }
  .reveal.in > :nth-child(3) { transition-delay: 160ms; }
  .hero .h-in { opacity: 0; transform: translateY(14px); animation: rise 720ms var(--ease) forwards; }
  .hero .h-in:nth-child(2) { animation-delay: 80ms; }
  .hero .h-in:nth-child(3) { animation-delay: 160ms; }
  .hero .h-in:nth-child(4) { animation-delay: 240ms; }
  .hero .h-in:nth-child(5) { animation-delay: 320ms; }
  @keyframes rise { to { opacity: 1; transform: none; } }
  @media (prefers-reduced-motion: reduce) {
    html { scroll-behavior: auto; }
    .reveal, .reveal .tier, .reveal .card, .reveal .pillar, .reveal .access { opacity: 1; transform: none; transition: none; }
    .hero .h-in { animation: none; opacity: 1; transform: none; }
    .tier:hover, .pillar:hover, .btn:hover { transform: none; }
  }

  /* ── Responsive ──────────────────────────────────────── */
  @media (max-width: 960px) {
    section { padding: 76px 0; }
    nav .btn.ghost { display: none; }
    nav .links { display: none; }
    .shift { padding: 84px 0; }
    .row { grid-template-columns: 1fr; gap: 36px; }
    .row.flip .copy { order: 0; }
    .row + .row { margin-top: 84px; }
    .cards, .tiers, .pillars { grid-template-columns: 1fr; }
    .access-grid { grid-template-columns: 1fr; }
    .access { border-right: 0; border-bottom: 1px solid var(--line); padding: 26px 4px 12px; }
    .access:last-child { border-bottom: 0; }
    .hero { padding: 56px 0 0; }
    .stage { margin-top: 48px; padding-bottom: 60px; }
    /* On a phone the shot stacks its frames; two tell the story, three make
       it a scroll. Chrome text stays on one line instead of wrapping to three. */
    .w-frames { flex-direction: column; }
    .w-frames .w-frame:nth-child(3) { display: none; }
    .w-tab, .w-pill, .w-sub span { white-space: nowrap; }
    .w-bar .w-tab:not(.on) { display: none; }
    .close-cta { padding: 60px 22px; border-radius: 20px; }
    .break .inner { padding: 24px 22px; }
    footer .top { gap: 28px; }
  }
</style>
</head>
<body>

<nav id="nav">
  <div class="wrap">
    <a class="brand" href="/">
      <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="8" fill="#1a1b17"/>
        <path d="M21.5 11.5a6 6 0 1 0 0 9" fill="none" stroke="#45a898" stroke-width="3" stroke-linecap="round"/>
        <path d="M14 11.5a6 6 0 1 0 0 9" fill="none" stroke="#a3a195" stroke-width="2" stroke-linecap="round" opacity="0.7"/>
      </svg>
      Commons
    </a>
    <div class="links">
      <a href="#features">Features</a>
      <a href="#how">How it works</a>
      <a href="#roles">Who it's for</a>
      <a href="#faq">FAQ</a>
    </div>
    <a class="btn ghost" href="${DOWNLOAD_URL}">Download</a>
    <a class="btn primary" href="${APP_URL}">Open Commons
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 8h9m0 0L8.5 4.5M12 8l-3.5 3.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </a>
  </div>
</nav>

<!-- ── Hero ─────────────────────────────────────────────── -->
<section class="hero">
  <div class="wrap">
    <p class="badge h-in"><span class="dot"></span> Free while in preview · <b>no invite needed</b></p>
    <h1 class="h-in">Design on the product,<br />not <em>pictures</em> of it.</h1>
    <p class="lede h-in">
      Commons puts your running app on a shared canvas. Your team comments on the real
      screens, hands feedback straight to a coding agent, and the reasoning stays attached
      to the work instead of scrolling away in chat.
    </p>
    <div class="cta-row h-in">
      <a class="btn primary lg" href="${APP_URL}">Open Commons in your browser
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 8h9m0 0L8.5 4.5M12 8l-3.5 3.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </a>
      <a class="btn ghost lg" href="${DOWNLOAD_URL}">Download for Mac</a>
    </div>
    <p class="fine h-in"><span>Sign in with Google or an email link</span><span>Full canvas in the browser</span><span>${buildLabel}</span></p>

    <div class="stage reveal">
      <div class="wf big">
        <span class="tag">Screenshot placeholder</span>
        <div class="w-bar">
          <div class="w-lights"><i></i><i></i><i></i></div>
          <div class="w-tab">Home</div>
          <div class="w-tab on">Felix Mobile App</div>
          <div class="w-tab">Gleamly Web</div>
          <div class="w-spacer"></div>
          <div class="w-avatars">
            <i style="background:#45a898"></i><i style="background:#c8743f"></i><i style="background:#a8712c"></i>
          </div>
        </div>
        <div class="w-sub">
          <div class="w-seg"><span class="on">Prototype</span><span>Canvas</span><span>Flow</span></div>
          <div class="w-dot" title="dev server ready"></div>
          <span style="color:var(--dark-ink-3);font-size:11px">dev · :4310 · main</span>
          <div class="w-spacer"></div>
          <div class="w-pill">Narrate</div>
          <div class="w-pill">Share</div>
        </div>
        <div class="w-canvas">
          <div class="w-frames">
            <div class="w-frame">
              <div class="w-frame-head"><b>Home</b> <span class="rt">/</span></div>
              <div class="w-body">
                <div class="w-l w40 accent"></div>
                <div class="w-l w85"></div>
                <div class="w-l w70"></div>
                <div class="w-box h72"></div>
                <div class="w-btn"></div>
              </div>
            </div>
            <div class="w-frame">
              <div class="w-frame-head"><b>Send money</b> <span class="rt">/send</span></div>
              <div class="w-body">
                <div class="w-l w50"></div>
                <div class="w-box h110"></div>
                <div class="w-l w70"></div>
                <div class="w-l w40 accent"></div>
              </div>
            </div>
            <div class="w-frame">
              <div class="w-frame-head"><b>Goals</b> <span class="rt">/savings</span></div>
              <div class="w-body">
                <div class="w-l w70"></div>
                <div class="w-l w50 accent"></div>
                <div class="w-box h46"></div>
                <div class="w-box h46"></div>
                <div class="w-l w85"></div>
              </div>
            </div>
          </div>
          <div class="w-pin" style="left:186px;top:126px">KC</div>
          <div class="w-pin" style="left:428px;top:216px;background:#45a898">MS</div>
          <div class="w-note" style="max-width:350px">
            The ask box holds its position no matter how long the answer runs, so beginning a
            question feels like focus, not a screen change.
            <span class="cite">commit 4cf2699</span><span class="cite">thread</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</section>

<!-- ── Works with ───────────────────────────────────────── -->
<div class="with">
  <div class="wrap">
    <span class="label">Works with</span>
    <span class="name">Next.js</span>
    <span class="name">Vite</span>
    <span class="name">Expo</span>
    <span class="name">React</span>
    <span class="name">SvelteKit</span>
    <span class="name">GitHub</span>
    <span class="name">Vercel</span>
    <span class="name">Figma</span>
    <span class="name">Slack</span>
    <span class="name">Claude Code</span>
  </div>
</div>
<hr class="rule" />

<!-- ── The shift ────────────────────────────────────────── -->
<section class="shift">
  <div class="wrap center">
    <h2>Mocks go stale the moment code lands.</h2>
    <p class="lede">
      When agents can ship a change in minutes, the design file is out of date by lunch.
      Commons moves the conversation onto the thing that actually runs, so feedback lands
      where the work is and nobody reviews a screenshot of last week.
    </p>
  </div>
</section>

<!-- ── Pillars ──────────────────────────────────────────── -->
<section id="features" class="band">
  <div class="wrap">
    <div class="center">
      <p class="eyebrow">What it does</p>
      <h2>Comment on it. Draft it. <em>Prove</em> it.</h2>
      <p class="lede">
        One canvas showing the app that actually runs, for the whole team that argues about it.
      </p>
    </div>
    <div class="pillars reveal">
      <div class="pillar">
        <div class="thumb">
          <div class="wf">
            <div class="w-bar"><div class="w-lights"><i></i><i></i><i></i></div><div class="w-tab on">Thread</div></div>
            <div class="w-mini">
              <div class="w-msg"><div class="w-who">Kyle</div><div class="w-l w85"></div><div class="w-l w50" style="margin-top:6px"></div></div>
              <div class="w-msg"><div class="w-who" style="color:#45a898">Maya</div><div class="w-l w70"></div></div>
            </div>
          </div>
        </div>
        <div class="body">
          <span class="k">Comment</span>
          <h3 class="serif">Pin feedback to the real screen</h3>
          <p>Click anywhere on the live app to start a thread anchored to that screen and route. Guests join from a link, no account.</p>
        </div>
      </div>
      <div class="pillar">
        <div class="thumb">
          <div class="wf">
            <div class="w-bar"><div class="w-lights"><i></i><i></i><i></i></div><div class="w-tab on">Agent</div><div class="w-spacer"></div><span style="color:#45a898;font-size:11px">running</span></div>
            <div class="w-mini">
              <div class="w-run"><span class="tick">✓</span> Read the screen and thread</div>
              <div class="w-run"><span class="tick">✓</span> Drafted on its own branch</div>
              <div class="w-run">● Building the preview…</div>
            </div>
          </div>
        </div>
        <div class="body">
          <span class="k">Draft</span>
          <h3 class="serif">Turn a thread into a working draft</h3>
          <p>Hand a comment to your coding agent. It picks up the screen, the route, and the conversation, and reports back with a preview link.</p>
        </div>
      </div>
      <div class="pillar">
        <div class="thumb">
          <div class="wf">
            <div class="w-bar"><div class="w-lights"><i></i><i></i><i></i></div><div class="w-tab on">Tests</div><div class="w-spacer"></div><span style="color:var(--dark-ink-3);font-size:11px">12 sessions</span></div>
            <div class="w-mini">
              <div class="w-row">Send to a saved contact <span class="pct">92%</span></div>
              <div class="w-row">Set up a recurring transfer <span class="pct low">41%</span></div>
            </div>
          </div>
        </div>
        <div class="body">
          <span class="k">Prove</span>
          <h3 class="serif">Test with real people, results on the canvas</h3>
          <p>Send one link. Testers use your live app in the browser, and success rates, heatmaps, and paths come back to the same screens.</p>
        </div>
      </div>
    </div>
  </div>
</section>

<!-- ── Feature rows ─────────────────────────────────────── -->
<section id="deep">
  <div class="wrap">

    <div class="row reveal">
      <div class="copy">
        <p class="eyebrow">Comment</p>
        <h2>Pin feedback to the live screen</h2>
        <p>
          Every screen on the canvas is your real app, rendered from a local dev server or a
          deployed preview link. Click anywhere to leave a comment anchored to that screen and
          route, not to a rectangle that used to look like it.
        </p>
        <ul>
          <li>Threads, replies, and @mentions with your teammates</li>
          <li>Live cursors and presence while you review together</li>
          <li>Share links open the same canvas: guests browse, read, and comment with just a name</li>
          <li>Figma frames land beside live screens, commentable like everything else</li>
          <li>Screens keep themselves current: a deploy refreshes every snapshot</li>
        </ul>
      </div>
      <div class="wf">
        <span class="tag">Screenshot placeholder</span>
        <div class="w-bar">
          <div class="w-tab on">Thread</div>
          <div class="w-spacer"></div>
          <span style="color:var(--dark-ink-3);font-size:11px">Home · /</span>
        </div>
        <div class="w-panel">
          <div class="w-msg">
            <div class="w-who">Kyle</div>
            <div class="w-txt">The balance reads as spendable but it aggregates linked accounts. Can we name it so nobody tries to send all of it?</div>
          </div>
          <div class="w-msg">
            <div class="w-who" style="color:#45a898">Maya</div>
            <div class="w-txt">Agreed. "Total across accounts" and keep the sendable figure separate.</div>
          </div>
          <div><span class="w-cta">⚡ Send to agent</span></div>
        </div>
      </div>
    </div>

    <div class="row flip reveal">
      <div class="copy">
        <p class="eyebrow">Agents</p>
        <h2>Turn a comment into a working draft</h2>
        <p>
          Hand a thread to your coding agent and it picks up the whole context: the screen,
          the route, the conversation. It works on its own branch and reports back, so review
          stays a conversation instead of a ticket handoff.
        </p>
        <ul>
          <li>Runs on your machine, or in your repo's own GitHub Actions with nobody's laptop awake</li>
          <li>Drafts live on a branch, never on a dirty tree</li>
          <li>Every draft gets a preview link the whole team can open</li>
          <li>Connect GitHub once and preview links fill themselves in from your deploys</li>
          <li>Your own Anthropic or OpenRouter key, set in the app, never in a terminal</li>
        </ul>
      </div>
      <div class="wf">
        <span class="tag">Screenshot placeholder</span>
        <div class="w-bar">
          <div class="w-tab on">Agent session</div>
          <div class="w-spacer"></div>
          <span style="color:var(--teal);font-size:11px">running</span>
        </div>
        <div class="w-panel">
          <div class="w-run"><span class="tick">✓</span> Read src/screens/bank.tsx</div>
          <div class="w-run"><span class="tick">✓</span> Renamed the aggregate label</div>
          <div class="w-run"><span class="tick">✓</span> Split sendable balance into its own row</div>
          <div class="w-run">● Running the build…</div>
          <div class="w-msg">
            <div class="w-who" style="color:#45a898">Draft ready</div>
            <div class="w-txt">commons/balance-label · 2 files changed. Open the draft preview to compare against main.</div>
          </div>
        </div>
      </div>
    </div>

    <div class="row reveal">
      <div class="copy">
        <p class="eyebrow">Narrate</p>
        <h2>The why, with receipts</h2>
        <p>
          Commons reads your comment threads, test results, and code history, then drafts the
          thinking behind each screen and cites where every claim came from. You approve what
          is right, and the rationale rides along with the work for whoever asks next quarter.
        </p>
        <ul>
          <li>Citations back to commits, docs, threads, and tests</li>
          <li>Honest labels when it is inferring rather than quoting</li>
          <li>Nothing is published until a person approves it</li>
        </ul>
      </div>
      <div class="wf">
        <span class="tag">Screenshot placeholder</span>
        <div class="w-bar">
          <div class="w-tab on">Narrate</div>
          <div class="w-spacer"></div>
          <span style="color:var(--dark-ink-3);font-size:11px">4 drafts to review</span>
        </div>
        <div class="w-panel">
          <div class="w-note" style="margin-top:0">
            Pay opens straight onto a full height keypad because the amount is the first thing
            your thumb meets, not a menu.
            <span class="cite">commit a91f22c</span><span class="cite">doc PLAN.md</span>
          </div>
          <div class="w-note" style="margin-top:0">
            The progress bars stay quiet on purpose, so the screen reads as encouragement rather
            than a performance dashboard.
            <span class="cite inf">inferred</span>
          </div>
          <div style="display:flex;gap:8px"><span class="w-cta">Approve</span>
            <span class="w-pill">Edit</span><span class="w-pill">Reject</span></div>
        </div>
      </div>
    </div>

    <div class="row flip reveal">
      <div class="copy">
        <p class="eyebrow">User tests</p>
        <h2>Test with real people, results on the canvas</h2>
        <p>
          Write tasks, send one link. Testers open your live app in the browser with no account
          and no install. Success rates, times, and the paths people took come back to the same
          canvas the team is already working on.
        </p>
        <ul>
          <li>Click heatmaps drawn straight onto the screens</li>
          <li>A and B variants against two preview links</li>
          <li>Recruit real visitors with one script tag on your site</li>
          <li>Failed tasks can go to an agent as a fix request</li>
        </ul>
      </div>
      <div class="wf">
        <span class="tag">Screenshot placeholder</span>
        <div class="w-bar">
          <div class="w-tab on">Tests</div>
          <div class="w-spacer"></div>
          <span style="color:var(--dark-ink-3);font-size:11px">12 sessions</span>
        </div>
        <div class="w-panel">
          <div>
            <div class="w-row">Send money to a saved contact <span class="pct">92%</span></div>
            <div class="w-row">Find the emergency fund balance <span class="pct">83%</span></div>
            <div class="w-row">Set up a recurring transfer <span class="pct low">41%</span></div>
          </div>
          <div class="w-heat">
            <i style="left:22%;top:26%"></i><i style="left:30%;top:34%"></i><i style="left:26%;top:52%"></i>
            <i style="left:64%;top:30%"></i><i style="left:70%;top:62%"></i><i style="left:44%;top:70%"></i>
            <i style="left:34%;top:42%"></i><i style="left:58%;top:48%"></i>
          </div>
          <div class="w-txt">Most misses land on the schedule row, not the amount field.</div>
        </div>
      </div>
    </div>

    <div class="row reveal">
      <div class="copy">
        <p class="eyebrow">Flow</p>
        <h2>The whole app as a map, drawn from real use</h2>
        <p>
          Screens laid out by how deep they sit in the journey, joined by the paths people
          actually took. Nobody maintains it: the edges come from recorded sessions, so the
          map is a record rather than a diagram someone last touched in March.
        </p>
        <ul>
          <li>Screens nobody ever reached are parked where you cannot miss them</li>
          <li>Error, empty, and loading states sit beside the happy path</li>
          <li>A browser crawl can go find those states in your deployed preview</li>
          <li>Nothing a crawl finds joins the map until a person approves it</li>
        </ul>
      </div>
      <div class="wf">
        <span class="tag">Screenshot placeholder</span>
        <div class="w-bar">
          <div class="w-tab on">Flow</div>
          <div class="w-spacer"></div>
          <span style="color:var(--dark-ink-3);font-size:11px">3 states to review</span>
        </div>
        <div class="w-panel">
          <div class="w-run"><span class="tick">✓</span> Home → Send money → Confirm</div>
          <div class="w-run"><span class="tick">✓</span> Home → Goals</div>
          <div class="w-run" style="color:var(--bronze)">◇ Recurring transfer · never reached</div>
          <div class="w-msg">
            <div class="w-who" style="color:#45a898">Crawl found 3 states</div>
            <div class="w-txt">Send money: empty amount, declined card, offline. Approve the ones that are real.</div>
          </div>
          <div style="display:flex;gap:8px"><span class="w-cta">Approve</span>
            <span class="w-pill">Reject</span></div>
        </div>
      </div>
    </div>

  </div>
</section>

<!-- ── Mid-page break ───────────────────────────────────── -->
<div class="break">
  <div class="wrap">
    <div class="inner reveal">
      <div>
        <p class="t">Add your first project in a couple of minutes.</p>
        <p class="s">Free while in preview. No invite, no install for the browser.</p>
      </div>
      <a class="btn primary lg" href="${APP_URL}">Open Commons
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 8h9m0 0L8.5 4.5M12 8l-3.5 3.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </a>
    </div>
  </div>
</div>

<!-- ── How it works ─────────────────────────────────────── -->
<section id="how">
  <div class="wrap">
    <div class="center">
      <p class="eyebrow">How it works</p>
      <h2>Two minutes to a shared canvas</h2>
    </div>
    <div class="cards reveal">
      <div class="card">
        <h3>Point Commons at your app</h3>
        <p>
          Connect GitHub and your deployed repos appear as projects on their own. Or point the
          Mac app at a repo: routes are found and every screen lands on the canvas. A monorepo
          asks which app you meant. No repo, no GitHub? Paste a preview URL.
        </p>
      </div>
      <div class="card">
        <h3>Bring the team in</h3>
        <p>
          Teammates sign in on the web and see the same screens with no install. For anyone
          outside the team, share a link that needs no account at all.
        </p>
      </div>
      <div class="card">
        <h3>Comment, draft, ship</h3>
        <p>
          Feedback becomes a thread, a thread becomes an agent draft, and the draft becomes a
          preview link anyone can open before it merges.
        </p>
      </div>
    </div>
  </div>
</section>

<!-- ── Roles ────────────────────────────────────────────── -->
<section id="roles" class="band">
  <div class="wrap">
    <div class="center">
      <p class="eyebrow">Who it's for</p>
      <h2>Three jobs, one canvas</h2>
      <p class="lede">
        The people who argue about a product rarely share a tool. Designers work in a file,
        engineers work in the repo, and PMs work in whatever screenshot reached them last.
        Commons is the same live app for all three.
      </p>
    </div>
    <div class="tiers reveal">
      <div class="tier">
        <div class="who">Product designers</div>
        <div class="how">Critique the build, not a picture of it</div>
        <ul>
          <li>Pin a comment to the real screen at the real breakpoint</li>
          <li>Figma frames sit on the same canvas as live screens</li>
          <li>Hand a thread to an agent and get a draft with a preview link</li>
          <li>Rationale drafted with citations, published only when you approve it</li>
          <li>Heatmaps and task results from real testers land on the screens</li>
        </ul>
      </div>
      <div class="tier">
        <div class="who">Engineers</div>
        <div class="how">Feedback that arrives with its context</div>
        <ul>
          <li>Point at the repo: routes are found and each screen runs from your dev server</li>
          <li>Agents run on your Mac or in your repo's own GitHub Actions</li>
          <li>Drafts land on a branch, never on a dirty tree, never merged for you</li>
          <li>A monorepo asks which app the project is instead of guessing</li>
          <li>Comments carry the route and the commit, so nothing arrives as "the thing looked wrong"</li>
        </ul>
      </div>
      <div class="tier">
        <div class="who">Product managers</div>
        <div class="how">See the state of it without asking anyone</div>
        <ul>
          <li>No install and no terminal: the full canvas runs in the browser</li>
          <li>Share a link with execs and customers who have no account</li>
          <li>Flow view draws every path real testers actually took</li>
          <li>Task success rates, times, and where people gave up</li>
          <li>Preview links keep themselves current from your deploys</li>
        </ul>
      </div>
    </div>
  </div>
</section>

<!-- ── Access ───────────────────────────────────────────── -->
<section id="access">
  <div class="wrap">
    <div class="center">
      <p class="eyebrow">Access</p>
      <h2>The right door for each person</h2>
      <p class="lede">
        One product, three levels of access. Nobody installs anything they do not need,
        and nothing is shared wider than you chose.
      </p>
    </div>
    <div class="access-grid reveal">
      <div class="access">
        <div class="who">Your team</div>
        <div class="how">Signed in, in your workspace</div>
        <ul>
          <li>Every project on the canvas</li>
          <li>Comment, narrate, run tests</li>
          <li>Mac app adds local dev servers and agents</li>
        </ul>
      </div>
      <div class="access">
        <div class="who">Anyone signed in</div>
        <div class="how">Their own workspace</div>
        <ul>
          <li>Bring their own projects</li>
          <li>Sees nothing of yours until invited</li>
          <li>Free to try in the browser</li>
        </ul>
      </div>
      <div class="access">
        <div class="who">Stakeholders and testers</div>
        <div class="how">A link, no account</div>
        <ul>
          <li>One project, view and comment</li>
          <li>Design rationale travels with it</li>
          <li>Perfect for usability sessions</li>
        </ul>
      </div>
    </div>
  </div>
</section>

<!-- ── FAQ ──────────────────────────────────────────────── -->
<section id="faq" class="band">
  <div class="wrap">
    <div class="center">
      <p class="eyebrow">Questions</p>
      <h2>The honest answers</h2>
    </div>
    <div class="faq">
      <details open>
        <summary>Do my teammates need the code to use this?</summary>
        <p>
          No. Whoever has the repo runs it locally and everyone else sees the same screens
          through a deployed preview link. Designers, PMs, and stakeholders never touch a
          terminal.
        </p>
      </details>
      <details>
        <summary>Will it touch my repository?</summary>
        <p>
          Only when you ask. Commons never works on a dirty tree, never merges for you, and
          never stores git credentials. Agent drafts live on their own branch and you decide
          what happens next.
        </p>
      </details>
      <details>
        <summary>Is it Mac only?</summary>
        <p>
          The desktop app is macOS today, and it is what you need to run dev servers and agents
          locally. Everything else, including the full canvas, works in any modern browser.
        </p>
      </details>
      <details>
        <summary>Does it replace Figma?</summary>
        <p>
          No. Figma is where you explore what does not exist yet. Commons is where the team
          works on what already runs. Most teams use both, and the handoff between them gets
          shorter.
        </p>
      </details>
      <details>
        <summary>What does connecting GitHub actually give you?</summary>
        <p>
          Your deployed repos appear as projects on their own: the next production deploy of
          a repo Commons has never seen becomes a project, preview link and all. Deploy events
          keep those links current, and agents get a place to run when no laptop is awake.
          Commons reads only the repos you picked during install, matches them only inside the
          workspace that installed it, and never recreates a project a person archived or
          deleted. You can run everything without it and paste preview URLs by hand.
        </p>
      </details>
      <details>
        <summary>My repo has a web app and a mobile app in it.</summary>
        <p>
          Commons asks which one the project is rather than picking for you. They are two
          projects: add the repo twice and choose a different app each time.
        </p>
      </details>
      <details>
        <summary>What does it cost?</summary>
        <p>
          Nothing while Commons is in preview. Agent runs use your own Anthropic or OpenRouter
          key, so you are never billed through us for model usage.
        </p>
      </details>
    </div>
  </div>
</section>

<!-- ── Closing CTA ──────────────────────────────────────── -->
<section>
  <div class="wrap">
    <div class="close-cta grain reveal">
      <h2>Put your product on the canvas.</h2>
      <p>
        Open Commons in the browser and add your first project in a couple of minutes.
        Bring the people who have opinions about it.
      </p>
      <div class="cta-row">
        <a class="btn primary lg" href="${APP_URL}">Open Commons
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 8h9m0 0L8.5 4.5M12 8l-3.5 3.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </a>
        <a class="btn ghost lg" href="${DOWNLOAD_URL}">Download for Mac</a>
      </div>
      <p class="fine"><span>Free while in preview</span><span>No invite needed</span><span>${buildLabel}</span></p>
    </div>
  </div>
</section>

<footer>
  <div class="wrap">
    <div class="top">
      <div class="brandcol">
        <a class="brand" href="/">
          <svg width="24" height="24" viewBox="0 0 32 32" aria-hidden="true">
            <rect width="32" height="32" rx="8" fill="#1a1b17"/>
            <path d="M21.5 11.5a6 6 0 1 0 0 9" fill="none" stroke="#45a898" stroke-width="3" stroke-linecap="round"/>
            <path d="M14 11.5a6 6 0 1 0 0 9" fill="none" stroke="#a3a195" stroke-width="2" stroke-linecap="round" opacity="0.7"/>
          </svg>
          Commons
        </a>
        <p class="tagline">One shared canvas showing the app that actually runs, for the whole team that argues about it.</p>
      </div>
      <div class="col">
        <span class="h">Product</span>
        <a href="${APP_URL}">Open Commons</a>
        <a href="${DOWNLOAD_URL}">Download for Mac</a>
        <a href="#faq">FAQ</a>
      </div>
      <div class="col">
        <span class="h">Explore</span>
        <a href="#features">Features</a>
        <a href="#how">How it works</a>
        <a href="#roles">Who it's for</a>
      </div>
    </div>
    <div class="meta">
      <span>Commons · design on the product</span>
      <span class="sp">${buildLabel}</span>
    </div>
  </div>
</footer>

<script>
  // Nav hairline appears once you leave the hero.
  var nav = document.getElementById("nav");
  var onScroll = function () { nav.classList.toggle("stuck", window.scrollY > 8); };
  addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  // Gentle reveal on first sight; no-op under reduced motion (CSS handles it).
  var items = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
      });
    }, { rootMargin: "0px 0px -10% 0px" });
    items.forEach(function (el) { io.observe(el); });
  } else {
    items.forEach(function (el) { el.classList.add("in"); });
  }
</script>
</body>
</html>`;
}
