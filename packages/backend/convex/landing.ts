/**
 * trycommons.app — the marketing page, served from the Convex site at "/".
 * Light Unified Craft (paper, ink, teal, serif display) with dark product
 * illustrations, so the page reads as calm and the app reads as focused.
 *
 * Self-contained on purpose: no fonts, scripts, or images fetched from
 * anywhere, so it renders instantly and survives any CSP. The product shots
 * are drawn in CSS (crisp at every density); swap in real screenshots by
 * replacing a .shot block with an <img>.
 *
 * The premium pass (2026-08-02) is presentation only — same claims, same
 * sections. What changed is the material system: a layered shadow-and-
 * hairline treatment on every raised surface (shots get a top highlight, a
 * ring, and a soft halo), a centered hero with a staged product shot, serif
 * numerals on the steps, gradient-faded rules between sections, and a real
 * footer. Every number in the type scale sits on a shared rhythm now, which
 * is most of what "premium" is.
 */

const APP_URL = "/app";
// Stable URL, resolved per request against the published release (see the
// /download route). Never hard-code a versioned artifact here: the filename
// changes every release, and updating this by hand is a step that gets missed.
const DOWNLOAD_URL = "/download";

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
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%231a1b17'/%3E%3Cpath d='M21.5 11.5a6 6 0 1 0 0 9' fill='none' stroke='%2345a898' stroke-width='3' stroke-linecap='round'/%3E%3C/svg%3E" />
<style>
  :root {
    --paper: #f3f0e8;
    --panel: #fbf9f4;
    --raised: #f6f3ec;
    --line: #e6e2d6;
    --line-mid: #d8d3c4;
    --ink: #26251e;
    --ink-2: #5c5a4f;
    --ink-3: #8f8d80;
    --accent: #1f7a6e;
    --accent-hover: #16665c;
    --accent-soft: rgba(31, 122, 110, 0.1);
    --dark: #1a1b17;
    --dark-panel: #21221d;
    --dark-line: #2a2b24;
    --dark-line-2: #363730;
    --dark-ink: #edebe0;
    --dark-ink-2: #a3a195;
    --dark-ink-3: #716f64;
    --teal: #45a898;
    --bronze: #b0722f;
    --serif: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif;
    --sans: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    --mono: ui-monospace, SFMono-Regular, Menlo, monospace;
    /* Raised-surface material: ambient + key + a hairline of sky caught on
       the top edge. One recipe everywhere, which is what makes it a material
       rather than a set of drop shadows. */
    --shadow-sm: 0 1px 2px rgba(50, 45, 25, 0.05), 0 6px 18px rgba(50, 45, 25, 0.06);
    --shadow: 0 1px 2px rgba(50, 45, 25, 0.05), 0 10px 28px rgba(50, 45, 25, 0.07), 0 28px 56px rgba(50, 45, 25, 0.07);
    --shadow-lg: 0 2px 4px rgba(50, 45, 25, 0.06), 0 24px 48px rgba(50, 45, 25, 0.1), 0 64px 128px rgba(50, 45, 25, 0.12);
    --shot-highlight: inset 0 1px 0 rgba(255, 255, 255, 0.07);
  }
  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; }
  body {
    margin: 0; background: var(--paper); color: var(--ink);
    font: 17px/1.65 var(--sans); -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
    /* The hero halo deliberately bleeds past the content column; clip (not
       hidden) so that never becomes a horizontal scroll, without turning body
       into a scroll container — hidden here breaks position: sticky. */
    overflow-x: clip;
  }
  .wrap { max-width: 1140px; margin: 0 auto; padding: 0 28px; }
  a { color: var(--accent); }

  /* Rules between sections fade at both ends: a hairline that starts and
     stops feels drawn; one that runs edge-to-edge feels like a table. */
  .rule { height: 1px; border: 0; margin: 0;
          background: linear-gradient(90deg, transparent, var(--line-mid) 18%, var(--line-mid) 82%, transparent); }

  /* ── Nav ─────────────────────────────────────────────── */
  nav {
    position: sticky; top: 0; z-index: 20;
    background: rgba(243, 240, 232, 0.82);
    backdrop-filter: saturate(160%) blur(14px);
    -webkit-backdrop-filter: saturate(160%) blur(14px);
    border-bottom: 1px solid transparent;
    transition: border-color 200ms ease, box-shadow 200ms ease;
  }
  nav.stuck { border-bottom-color: var(--line); box-shadow: 0 6px 24px rgba(50, 45, 25, 0.05); }
  nav .wrap { display: flex; align-items: center; gap: 28px; height: 64px; }
  .brand { font-family: var(--serif); font-size: 21px; font-weight: 600; letter-spacing: -0.01em;
           color: var(--ink); text-decoration: none; display: flex; align-items: center; gap: 9px; }
  .brand svg { display: block; }
  nav .links { display: flex; gap: 4px; margin-left: auto; }
  nav .links a {
    color: var(--ink-2); text-decoration: none; font-size: 14.5px; font-weight: 500;
    padding: 7px 12px; border-radius: 8px; transition: color 140ms ease, background 140ms ease;
  }
  nav .links a:hover { color: var(--ink); background: rgba(38, 37, 30, 0.05); }
  .btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 8px;
    font: inherit; font-size: 15px; font-weight: 500; text-decoration: none;
    padding: 9px 17px; border-radius: 10px; border: 1px solid transparent; cursor: pointer;
    transition: background 160ms ease, border-color 160ms ease, transform 160ms ease, box-shadow 160ms ease;
  }
  .btn:active { transform: scale(0.98); }
  .btn.primary {
    background: var(--accent); color: #fff;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.14), 0 1px 2px rgba(22, 102, 92, 0.35);
  }
  .btn.primary:hover { background: var(--accent-hover); }
  .btn.ghost { background: var(--panel); color: var(--ink); border-color: var(--line-mid); box-shadow: var(--shadow-sm); }
  .btn.ghost:hover { background: var(--raised); border-color: var(--ink-3); }
  .btn.lg { padding: 14px 26px; font-size: 16.5px; border-radius: 12px; }
  .btn.lg.primary { box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.14), 0 2px 6px rgba(22, 102, 92, 0.3), 0 12px 28px rgba(22, 102, 92, 0.18); }

  /* ── Type ────────────────────────────────────────────── */
  section { padding: 108px 0; }
  .eyebrow { font-size: 12.5px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase;
             color: var(--accent); margin: 0 0 18px; }
  h1 { font-family: var(--serif); font-size: clamp(40px, 6.4vw, 68px); line-height: 1.04;
       letter-spacing: -0.024em; margin: 0 0 22px; font-weight: 600; text-wrap: balance; }
  h2 { font-family: var(--serif); font-size: clamp(28px, 3.6vw, 42px); line-height: 1.12;
       letter-spacing: -0.018em; margin: 0 0 16px; font-weight: 600; text-wrap: balance; }
  h3 { font-size: 19px; line-height: 1.35; margin: 0 0 8px; font-weight: 600; letter-spacing: -0.005em; }
  .lede { font-size: clamp(18px, 2.1vw, 20.5px); line-height: 1.6; color: var(--ink-2); margin: 0 0 32px; max-width: 52ch; text-wrap: pretty; }
  .center { text-align: center; }
  .center .lede { margin-left: auto; margin-right: auto; }

  /* ── Hero ────────────────────────────────────────────── */
  .hero { padding: 84px 0 0; text-align: center; }
  .badge {
    display: inline-flex; align-items: center; gap: 8px; margin-bottom: 26px;
    padding: 6px 14px; border: 1px solid var(--line-mid); border-radius: 999px;
    background: var(--panel); box-shadow: var(--shadow-sm);
    font-size: 13.5px; font-weight: 500; color: var(--ink-2);
  }
  .badge b { color: var(--accent); font-weight: 600; }
  .badge .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); }
  .hero h1 { max-width: 21ch; margin-left: auto; margin-right: auto; }
  .hero .lede { margin: 0 auto 34px; }
  .hero .cta-row { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: center; }
  .hero .fine { margin: 18px 0 0; font-size: 14px; color: var(--ink-3); }
  .hero .fine span + span::before { content: "·"; margin: 0 9px; color: var(--line-mid); }

  /* The stage: the product sits in a pool of its own light. The halo is the
     one gradient flourish on the page, and it earns its place — a dark shot
     dropped straight onto paper reads pasted-on; lit from behind it reads
     placed. */
  .stage { position: relative; margin-top: 68px; padding-bottom: 96px; }
  .stage::before {
    content: ""; position: absolute; inset: -8% -12% 0;
    background: radial-gradient(ellipse 62% 54% at 50% 42%, rgba(69, 168, 152, 0.16), rgba(176, 114, 47, 0.05) 58%, transparent 74%);
    pointer-events: none;
  }
  .stage .shot { position: relative; }

  /* ── Works-with strip ────────────────────────────────── */
  .with { padding: 34px 0 30px; }
  .with .wrap { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 10px 8px; }
  .with .label { font-size: 12.5px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-3); margin-right: 10px; }
  .chip {
    padding: 6px 14px; border: 1px solid var(--line); border-radius: 999px;
    background: var(--panel); font-size: 14px; font-weight: 500; color: var(--ink-2);
  }

  /* ── The shift ───────────────────────────────────────── */
  .shift { padding: 118px 0; }
  .shift h2 { font-size: clamp(30px, 4.2vw, 48px); max-width: 22ch; margin: 0 auto 18px; }
  .shift .lede { max-width: 56ch; margin-bottom: 0; }

  /* ── Feature rows ────────────────────────────────────── */
  .row { display: grid; grid-template-columns: 1fr 1.15fr; gap: 72px; align-items: center; }
  .row + .row { margin-top: 132px; }
  .row.flip .copy { order: 2; }
  .row h2 { font-size: clamp(25px, 2.9vw, 34px); }
  .row p { color: var(--ink-2); margin: 0 0 14px; text-wrap: pretty; }
  .row ul { margin: 20px 0 0; padding: 0; list-style: none; }
  .row li { position: relative; padding-left: 28px; margin-bottom: 10px; color: var(--ink-2); font-size: 16px; }
  .row li::before {
    content: ""; position: absolute; left: 2px; top: 7px; width: 12px; height: 12px;
    border-radius: 50%; background: var(--accent-soft);
    box-shadow: inset 0 0 0 1px rgba(31, 122, 110, 0.35);
  }
  .row li::after {
    content: ""; position: absolute; left: 6px; top: 11px; width: 4px; height: 4px;
    border-radius: 50%; background: var(--accent);
  }

  /* ── Steps ───────────────────────────────────────────── */
  .cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin-top: 52px;
           counter-reset: step; position: relative; }
  .card {
    background: var(--panel); border: 1px solid var(--line); border-radius: 18px; padding: 30px 28px 26px;
    box-shadow: var(--shadow-sm); position: relative;
  }
  .card::before {
    counter-increment: step; content: counter(step, decimal-leading-zero);
    display: block; font-family: var(--serif); font-size: 44px; line-height: 1;
    color: var(--accent); opacity: 0.28; margin-bottom: 18px; letter-spacing: -0.02em;
  }
  .card p { margin: 0; color: var(--ink-2); font-size: 15.5px; }

  .band { background: var(--panel); border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }

  /* ── Role + access tiers ─────────────────────────────── */
  .tiers { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin-top: 52px; }
  .tier {
    border: 1px solid var(--line-mid); border-radius: 18px; padding: 28px 26px; background: var(--panel);
    box-shadow: var(--shadow-sm); text-align: left;
    transition: transform 200ms ease, box-shadow 200ms ease, border-color 200ms ease;
  }
  .tier:hover { transform: translateY(-3px); box-shadow: var(--shadow); border-color: var(--ink-3); }
  .tier .who { font-family: var(--serif); font-size: 21px; font-weight: 600; letter-spacing: -0.01em; margin-bottom: 6px; }
  .tier .how { font-size: 14px; color: var(--accent); font-weight: 500; margin-bottom: 16px; }
  .tier ul { margin: 0; padding: 0; list-style: none; }
  .tier li { position: relative; padding-left: 22px; margin-bottom: 9px; color: var(--ink-2); font-size: 15px; }
  .tier li::before { content: ""; position: absolute; left: 2px; top: 8px; width: 5px; height: 5px;
                     border-radius: 50%; background: var(--accent); opacity: 0.6; }

  /* ── FAQ ─────────────────────────────────────────────── */
  .faq { max-width: 780px; margin: 44px auto 0; }
  details { border-bottom: 1px solid var(--line); }
  summary { cursor: pointer; font-weight: 600; font-size: 17px; list-style: none;
            display: flex; gap: 12px; align-items: baseline; padding: 20px 4px;
            transition: color 140ms ease; }
  summary:hover { color: var(--accent-hover); }
  summary::-webkit-details-marker { display: none; }
  summary::after { content: "+"; margin-left: auto; color: var(--ink-3); font-weight: 400;
                   font-size: 20px; line-height: 1; transition: transform 200ms ease; }
  details[open] summary::after { transform: rotate(45deg); }
  details p { color: var(--ink-2); margin: 0 4px 20px; font-size: 16px; max-width: 62ch; }

  /* ── Closing CTA + footer ────────────────────────────── */
  .close-cta {
    position: relative; overflow: hidden;
    background: var(--dark); color: var(--dark-ink); border: 1px solid var(--dark-line-2);
    border-radius: 24px; padding: 76px 40px; text-align: center; box-shadow: var(--shadow-lg);
  }
  .close-cta::before {
    /* The app's own canvas: dot grid with a soft pool of teal, the same
       figure/ground the product uses. */
    content: ""; position: absolute; inset: 0;
    background-image: radial-gradient(circle, #34352d 1.1px, transparent 1.1px);
    background-size: 22px 22px;
  }
  .close-cta::after {
    content: ""; position: absolute; inset: 0;
    background: radial-gradient(ellipse 58% 68% at 50% 100%, rgba(69, 168, 152, 0.14), transparent 70%);
  }
  .close-cta > * { position: relative; z-index: 1; }
  .close-cta h2 { color: var(--dark-ink); }
  .close-cta p { color: var(--dark-ink-2); max-width: 46ch; margin: 0 auto 32px; }
  .close-cta .btn.ghost { background: transparent; color: var(--dark-ink); border-color: var(--dark-line-2); box-shadow: none; }
  .close-cta .btn.ghost:hover { background: rgba(255, 255, 255, 0.06); border-color: var(--dark-ink-3); }

  footer { padding: 56px 0 64px; color: var(--ink-3); font-size: 14.5px; }
  footer .top { display: flex; flex-wrap: wrap; gap: 32px 64px; align-items: flex-start; }
  footer .brandcol { max-width: 300px; }
  footer .brandcol .brand { margin-bottom: 10px; }
  footer .tagline { margin: 0; color: var(--ink-3); font-size: 14px; line-height: 1.55; }
  footer .col { display: flex; flex-direction: column; gap: 9px; min-width: 130px; }
  footer .col .h { font-size: 12.5px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-3); margin-bottom: 3px; }
  footer a { color: var(--ink-2); text-decoration: none; }
  footer a:hover { color: var(--ink); }
  footer .meta { display: flex; flex-wrap: wrap; gap: 16px; margin-top: 40px; padding-top: 22px;
                 border-top: 1px solid var(--line); font-size: 13.5px; }
  footer .meta .sp { margin-left: auto; }

  /* ── Dark product illustrations ──────────────────────── */
  .shot {
    background: var(--dark); border: 1px solid var(--dark-line-2); border-radius: 16px;
    box-shadow: var(--shot-highlight), var(--shadow); overflow: hidden; color: var(--dark-ink);
    font-size: 12px; line-height: 1.4;
  }
  .shot.big { border-radius: 20px; box-shadow: var(--shot-highlight), var(--shadow-lg); }
  .s-bar { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-bottom: 1px solid var(--dark-line); }
  .s-lights { display: flex; gap: 6px; }
  .s-lights i { width: 10px; height: 10px; border-radius: 50%; background: var(--dark-line-2); display: block; }
  .s-tab { padding: 4px 12px; border-radius: 7px; color: var(--dark-ink-2); font-size: 11.5px; }
  .s-tab.on { background: #2b2c25; color: var(--dark-ink); }
  .s-sub { display: flex; align-items: center; gap: 10px; padding: 8px 14px; border-bottom: 1px solid var(--dark-line); }
  .s-seg { display: flex; border: 1px solid var(--dark-line); border-radius: 7px; overflow: hidden; }
  .s-seg span { padding: 3px 10px; font-size: 11px; color: var(--dark-ink-3); }
  .s-seg span.on { background: #2b2c25; color: var(--dark-ink); }
  .s-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--teal); }
  .s-spacer { margin-left: auto; }
  .s-pill { padding: 3px 10px; border: 1px solid var(--dark-line-2); border-radius: 999px; font-size: 11px; color: var(--dark-ink-2); }
  .s-canvas {
    position: relative; padding: 26px; min-height: 300px;
    background-image: radial-gradient(circle, #34352d 1.1px, transparent 1.1px);
    background-size: 22px 22px;
  }
  .s-frames { display: flex; gap: 20px; align-items: flex-start; }
  .s-frame { flex: 1; background: var(--dark-panel); border: 1px solid var(--dark-line); border-radius: 9px; overflow: hidden; }
  .s-frame-head { display: flex; gap: 7px; align-items: center; padding: 6px 9px; border-bottom: 1px solid var(--dark-line);
                  font-size: 10.5px; color: var(--dark-ink-2); }
  .s-frame-head b { color: var(--dark-ink); font-weight: 600; }
  .s-frame-head .rt { color: var(--dark-ink-3); font-family: var(--mono); font-size: 9.5px; }
  .s-body { padding: 12px; display: grid; gap: 7px; }
  .s-l { height: 8px; border-radius: 4px; background: #2e2f28; }
  .s-l.w70 { width: 70%; } .s-l.w50 { width: 50%; } .s-l.w85 { width: 85%; } .s-l.w40 { width: 40%; }
  .s-l.accent { background: rgba(69,168,152,0.42); }
  .s-block { height: 46px; border-radius: 7px; background: #2b2c25; }
  .s-btn { height: 22px; width: 96px; border-radius: 999px; background: var(--teal); opacity: 0.85; }
  .s-pin {
    position: absolute; width: 22px; height: 22px; border-radius: 11px 11px 11px 3px;
    background: #7c9cf5; color: #14151a; font-size: 9.5px; font-weight: 700;
    display: flex; align-items: center; justify-content: center;
    box-shadow: 0 4px 10px rgba(0, 0, 0, 0.4);
  }
  .s-note {
    background: var(--dark-panel); border: 1px solid var(--dark-line);
    border-left: 3px solid var(--teal); border-radius: 8px; padding: 9px 11px;
    color: var(--dark-ink-2); font-size: 11px; line-height: 1.45; margin-top: 10px;
  }
  .s-note .cite { display: inline-block; margin-top: 6px; margin-right: 5px; padding: 1px 7px;
                  border: 1px solid var(--dark-line-2); border-radius: 999px; font-size: 9.5px; color: var(--dark-ink-3); }
  .s-note .cite.inf { border-style: dashed; border-color: #8a6d2f; color: #d9a03f; }
  .s-panel { padding: 14px; display: grid; gap: 10px; }
  .s-msg { background: var(--dark-panel); border: 1px solid var(--dark-line); border-radius: 9px; padding: 10px 12px; }
  .s-who { font-size: 11px; font-weight: 600; color: #7c9cf5; margin-bottom: 5px; }
  .s-txt { color: var(--dark-ink-2); font-size: 11.5px; }
  .s-run { display: flex; align-items: center; gap: 8px; font-size: 11px; color: var(--dark-ink-3);
           font-family: var(--mono); }
  .s-run .tick { color: var(--teal); }
  .s-cta { display: inline-flex; align-items: center; gap: 6px; padding: 5px 12px; border-radius: 8px;
           background: var(--teal); color: #10231f; font-size: 11.5px; font-weight: 600; }
  .s-row { display: flex; align-items: center; gap: 10px; padding: 9px 0; border-bottom: 1px solid var(--dark-line); font-size: 11.5px; }
  .s-row:last-child { border-bottom: none; }
  .s-row .pct { margin-left: auto; color: var(--teal); font-weight: 600; }
  .s-row .pct.low { color: #d9a03f; }
  .s-heat { position: relative; height: 92px; border-radius: 8px; background: #2b2c25; overflow: hidden; }
  .s-heat i { position: absolute; width: 9px; height: 9px; border-radius: 50%; background: rgba(217,160,63,0.85); }
  .s-avatars { display: flex; }
  .s-avatars i { width: 20px; height: 20px; border-radius: 50%; border: 2px solid var(--dark); margin-left: -6px; display: block; }

  /* ── Motion (respectful) ─────────────────────────────── */
  .reveal { opacity: 0; transform: translateY(16px); transition: opacity 640ms ease, transform 640ms ease; }
  .reveal.in { opacity: 1; transform: none; }
  /* Grids arrive as a cascade, not a block — one reveal, staggered children. */
  .reveal .tier, .reveal .card { opacity: 0; transform: translateY(10px);
    transition: opacity 520ms ease, transform 520ms ease; }
  .reveal.in .tier, .reveal.in .card { opacity: 1; transform: none; }
  .reveal.in > :nth-child(2) { transition-delay: 70ms; }
  .reveal.in > :nth-child(3) { transition-delay: 140ms; }
  @media (prefers-reduced-motion: reduce) {
    html { scroll-behavior: auto; }
    .reveal, .reveal .tier, .reveal .card { opacity: 1; transform: none; transition: none; }
    .tier:hover { transform: none; }
  }

  /* ── Responsive ──────────────────────────────────────── */
  @media (max-width: 900px) {
    section { padding: 68px 0; }
    /* One CTA is the premium move on a phone; two buttons plus a wordmark is
       a squeeze. Download still lives in the hero, the close CTA, and the
       footer. */
    nav .btn.ghost { display: none; }
    .shift { padding: 76px 0; }
    .row { grid-template-columns: 1fr; gap: 34px; }
    .row.flip .copy { order: 0; }
    .row + .row { margin-top: 76px; }
    .cards, .tiers { grid-template-columns: 1fr; }
    nav .links { display: none; }
    .hero { padding: 52px 0 0; }
    .stage { margin-top: 44px; padding-bottom: 56px; }
    .close-cta { padding: 52px 22px; border-radius: 18px; }
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
      <a href="#roles">Who it's for</a>
      <a href="#features">Features</a>
      <a href="#how">How it works</a>
      <a href="#faq">FAQ</a>
    </div>
    <a class="btn ghost" href="${DOWNLOAD_URL}">Download</a>
    <a class="btn primary" href="${APP_URL}">Open Commons</a>
  </div>
</nav>

<!-- ── Hero ─────────────────────────────────────────────── -->
<section class="hero">
  <div class="wrap">
    <p class="badge"><span class="dot"></span> Free while in preview · <b>no invite needed</b></p>
    <h1>Design on the product,<br />not pictures of it.</h1>
    <p class="lede">
      Commons puts your running app on a shared canvas. Your team comments on the real
      screens, hands feedback straight to a coding agent, and the reasoning stays attached
      to the work instead of scrolling away in chat.
    </p>
    <div class="cta-row">
      <a class="btn primary lg" href="${APP_URL}">Open Commons in your browser</a>
      <a class="btn ghost lg" href="${DOWNLOAD_URL}">Download for Mac</a>
    </div>
    <p class="fine"><span>Sign in with Google or an email link</span><span>Full canvas in the browser</span><span>${buildLabel}</span></p>

    <div class="stage reveal">
      <div class="shot big">
        <div class="s-bar">
          <div class="s-lights"><i></i><i></i><i></i></div>
          <div class="s-tab">Home</div>
          <div class="s-tab on">Felix Mobile App</div>
          <div class="s-tab">Gleamly Web</div>
          <div class="s-spacer"></div>
          <div class="s-avatars">
            <i style="background:#45a898"></i><i style="background:#7c9cf5"></i><i style="background:#b0722f"></i>
          </div>
        </div>
        <div class="s-sub">
          <div class="s-seg"><span class="on">Canvas</span><span>Prototype</span></div>
          <div class="s-dot" title="dev server ready"></div>
          <span style="color:var(--dark-ink-3);font-size:11px">dev · :4310 · main</span>
          <div class="s-spacer"></div>
          <div class="s-pill">Narrate</div>
          <div class="s-pill">Share</div>
        </div>
        <div class="s-canvas">
          <div class="s-frames">
            <div class="s-frame">
              <div class="s-frame-head"><b>Home</b> <span class="rt">/</span></div>
              <div class="s-body">
                <div class="s-l w40 accent"></div>
                <div class="s-l w85"></div>
                <div class="s-l w70"></div>
                <div class="s-block"></div>
                <div class="s-btn"></div>
              </div>
            </div>
            <div class="s-frame">
              <div class="s-frame-head"><b>Send money</b> <span class="rt">/send</span></div>
              <div class="s-body">
                <div class="s-l w50"></div>
                <div class="s-block"></div>
                <div class="s-l w70"></div>
                <div class="s-l w40 accent"></div>
              </div>
            </div>
            <div class="s-frame">
              <div class="s-frame-head"><b>Goals</b> <span class="rt">/savings</span></div>
              <div class="s-body">
                <div class="s-l w70"></div>
                <div class="s-l w50 accent"></div>
                <div class="s-block"></div>
                <div class="s-l w85"></div>
              </div>
            </div>
          </div>
          <div class="s-pin" style="left:180px;top:120px">KC</div>
          <div class="s-pin" style="left:420px;top:210px;background:#45a898">MS</div>
          <div class="s-note" style="max-width:340px">
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
    <span class="chip">Next.js</span>
    <span class="chip">Expo</span>
    <span class="chip">Vite</span>
    <span class="chip">GitHub</span>
    <span class="chip">Vercel</span>
    <span class="chip">Figma</span>
    <span class="chip">Slack</span>
    <span class="chip">Claude Code</span>
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

<!-- ── Features ─────────────────────────────────────────── -->
<section id="features">
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
          <li>Anyone can comment from a link, with no account</li>
          <li>Share links open the same canvas — guests browse, read, and comment with just a name</li>
          <li>Figma frames land beside live screens, commentable like everything else</li>
          <li>Screens keep themselves current: a deploy refreshes every snapshot</li>
        </ul>
      </div>
      <div class="shot">
        <div class="s-bar">
          <div class="s-tab on">Thread</div>
          <div class="s-spacer"></div>
          <span style="color:var(--dark-ink-3);font-size:11px">Home · /</span>
        </div>
        <div class="s-panel">
          <div class="s-msg">
            <div class="s-who">Kyle</div>
            <div class="s-txt">The balance reads as spendable but it aggregates linked accounts. Can we name it so nobody tries to send all of it?</div>
          </div>
          <div class="s-msg">
            <div class="s-who" style="color:#45a898">Maya</div>
            <div class="s-txt">Agreed. "Total across accounts" and keep the sendable figure separate.</div>
          </div>
          <div><span class="s-cta">⚡ Send to agent</span></div>
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
      <div class="shot">
        <div class="s-bar">
          <div class="s-tab on">Agent session</div>
          <div class="s-spacer"></div>
          <span style="color:var(--teal);font-size:11px">running</span>
        </div>
        <div class="s-panel">
          <div class="s-run"><span class="tick">✓</span> Read src/screens/bank.tsx</div>
          <div class="s-run"><span class="tick">✓</span> Renamed the aggregate label</div>
          <div class="s-run"><span class="tick">✓</span> Split sendable balance into its own row</div>
          <div class="s-run">● Running the build…</div>
          <div class="s-msg">
            <div class="s-who" style="color:#45a898">Draft ready</div>
            <div class="s-txt">commons/balance-label · 2 files changed. Open the draft preview to compare against main.</div>
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
      <div class="shot">
        <div class="s-bar">
          <div class="s-tab on">Narrate</div>
          <div class="s-spacer"></div>
          <span style="color:var(--dark-ink-3);font-size:11px">4 drafts to review</span>
        </div>
        <div class="s-panel">
          <div class="s-note" style="margin-top:0">
            Pay opens straight onto a full height keypad because the amount is the first thing
            your thumb meets, not a menu.
            <span class="cite">commit a91f22c</span><span class="cite">doc PLAN.md</span>
          </div>
          <div class="s-note" style="margin-top:0">
            The progress bars stay quiet on purpose, so the screen reads as encouragement rather
            than a performance dashboard.
            <span class="cite inf">inferred</span>
          </div>
          <div style="display:flex;gap:8px"><span class="s-cta">Approve</span>
            <span class="s-pill">Edit</span><span class="s-pill">Reject</span></div>
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
      <div class="shot">
        <div class="s-bar">
          <div class="s-tab on">Tests</div>
          <div class="s-spacer"></div>
          <span style="color:var(--dark-ink-3);font-size:11px">12 sessions</span>
        </div>
        <div class="s-panel">
          <div>
            <div class="s-row">Send money to a saved contact <span class="pct">92%</span></div>
            <div class="s-row">Find the emergency fund balance <span class="pct">83%</span></div>
            <div class="s-row">Set up a recurring transfer <span class="pct low">41%</span></div>
          </div>
          <div class="s-heat">
            <i style="left:22%;top:26%"></i><i style="left:30%;top:34%"></i><i style="left:26%;top:52%"></i>
            <i style="left:64%;top:30%"></i><i style="left:70%;top:62%"></i><i style="left:44%;top:70%"></i>
            <i style="left:34%;top:42%"></i><i style="left:58%;top:48%"></i>
          </div>
          <div class="s-txt">Most misses land on the schedule row, not the amount field.</div>
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
          <li>Comments, zoom, and share links work here exactly as on the canvas</li>
        </ul>
      </div>
      <div class="shot">
        <div class="s-bar">
          <div class="s-tab on">Flow</div>
          <div class="s-spacer"></div>
          <span style="color:var(--dark-ink-3);font-size:11px">3 states to review</span>
        </div>
        <div class="s-panel">
          <div class="s-run"><span class="tick">✓</span> Home → Send money → Confirm</div>
          <div class="s-run"><span class="tick">✓</span> Home → Goals</div>
          <div class="s-run" style="color:var(--bronze)">◇ Recurring transfer · never reached</div>
          <div class="s-msg">
            <div class="s-who" style="color:#45a898">Crawl found 3 states</div>
            <div class="s-txt">Send money: empty amount, declined card, offline. Approve the ones that are real.</div>
          </div>
          <div style="display:flex;gap:8px"><span class="s-cta">Approve</span>
            <span class="s-pill">Reject</span></div>
        </div>
      </div>
    </div>

  </div>
</section>

<!-- ── How it works ─────────────────────────────────────── -->
<section id="how" class="band">
  <div class="wrap">
    <div class="center">
      <p class="eyebrow">How it works</p>
      <h2>Two minutes to a shared canvas</h2>
    </div>
    <div class="cards reveal">
      <div class="card">
        <h3>Point Commons at your app</h3>
        <p>
          On the Mac app, choose your repo and Commons finds your routes and puts every screen
          on the canvas. A monorepo asks which app you meant. No repo on hand? Paste your
          deployed preview URL instead.
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
    <div class="tiers reveal">
      <div class="tier">
        <div class="who">Your team</div>
        <div class="how">Signed in, in your workspace</div>
        <ul>
          <li>Every project on the canvas</li>
          <li>Comment, narrate, run tests</li>
          <li>Mac app adds local dev servers and agents</li>
        </ul>
      </div>
      <div class="tier">
        <div class="who">Anyone signed in</div>
        <div class="how">Their own workspace</div>
        <ul>
          <li>Bring their own projects</li>
          <li>Sees nothing of yours until invited</li>
          <li>Free to try in the browser</li>
        </ul>
      </div>
      <div class="tier">
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
          Deploy events, so preview links fill themselves in instead of being pasted, and a
          place to run agents when no laptop is awake. Commons reads the deploys of repos you
          picked during install, and matches them only inside the workspace that installed it.
          You can run everything without it and paste preview URLs by hand.
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
    <div class="close-cta reveal">
      <h2>Put your product on the canvas</h2>
      <p>
        Open Commons in the browser and add your first project in a couple of minutes.
        Bring the people who have opinions about it.
      </p>
      <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap">
        <a class="btn primary lg" href="${APP_URL}">Open Commons</a>
        <a class="btn ghost lg" href="${DOWNLOAD_URL}">Download for Mac</a>
      </div>
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
        <a href="#roles">Who it's for</a>
        <a href="#features">Features</a>
        <a href="#how">How it works</a>
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
    }, { rootMargin: "0px 0px -12% 0px" });
    items.forEach(function (el) { io.observe(el); });
  } else {
    items.forEach(function (el) { el.classList.add("in"); });
  }
</script>
</body>
</html>`;
}
