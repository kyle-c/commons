/**
 * trycommons.app, the marketing page, served from the Convex site at "/".
 *
 * Concept: the page is a crit in progress on a Commons canvas, and the
 * visitor is invited in. It borrows only from the product's own playful
 * vocabulary: the critique stickers (slapped down with the app's squash
 * landing and the app's own synthesized voices, peeled off with a click),
 * sticky notes, multiplayer cursors, marker markup, and the canvas dot glow.
 *
 * Two things to play with:
 * - The hero loop (pin, thread, agent, draft) plays on its own, then hands
 *   over: "your turn". Click a screen, write a comment, send it to the agent,
 *   and a demo draft comes back with your pin highlighted. It is scripted
 *   entirely in the page (no model calls) and says so when it finishes.
 * - The sticker dock: sticker mode from the app. Pick one, click anywhere.
 *
 * Color: the brand's light canvas, ember for what you can do, bronze for
 * conversation, and the project status hues tinting the five flow steps in
 * order, so color tracks progress. Type: Fraunces (soft and wonky axes up)
 * for display, Figtree for reading, Shantell Sans only for notes, subset to
 * exactly the characters those notes use. Mono falls to the system (SF Mono
 * on a Mac), which is what the app itself uses.
 *
 * Measured, not guessed: a cookie-less beacon (POST /api/lp) counts views and
 * each door (open the app, download, stickers, the demo) per day. See
 * landingStats.ts. The share card is /og.jpg, rendered from scripts/og.
 *
 * The phones and panels are wireframe illustrations, not screenshots; swap a
 * .ph or .vig block for an <img> when real captures exist.
 */

const APP_URL = "/app";
// Stable URL, resolved per request against the published release (see the
// /download route). Never hard-code a versioned artifact here: the filename
// changes every release, and updating this by hand is a step that gets missed.
const DOWNLOAD_URL = "/download";

const CURSOR = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.2 1.4l10.6 6.3-4.6 1.2-2.3 4.3z" fill="currentColor" stroke="#26251e" stroke-width="1.1" stroke-linejoin="round"/></svg>`;

const MARK = (size: number) => `<svg width="${size}" height="${size}" viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="9" fill="#26251e"/>
        <path d="M21.5 11.5a6 6 0 1 0 0 9" fill="none" stroke="#d98a54" stroke-width="3" stroke-linecap="round"/>
        <path d="M14 11.5a6 6 0 1 0 0 9" fill="none" stroke="#fbf9f4" stroke-width="2" stroke-linecap="round" opacity="0.6"/>
      </svg>`;

// The product's critique vocabulary, in dock order: emoji (as an HTML
// entity), its name, and the voice key the synthesizer plays for it.
const STICKERS: [string, string, string][] = [
  ["&#10084;&#65039;", "Love it", "heart"],
  ["&#128293;", "This is fire", "fire"],
  ["&#129300;", "Hmm", "hmm"],
  ["&#128533;", "Not sure", "unsure"],
  ["&#9986;&#65039;", "Cut it", "cut"],
  ["&#128161;", "Idea", "idea"],
  ["&#127881;", "Ship it", "party"],
  ["&#128064;", "Look here", "look"],
];
const DOCK = STICKERS.map(
  ([e, name, voice]) =>
    `<button type="button" class="stk-btn" data-e="${e}" data-v="${voice}" aria-label="${name}" title="${name}">${e}</button>`
).join("");

// Everything set in the marker hand. The font request is subset to exactly
// these characters, so the handwriting costs a few kilobytes instead of 77.
const NOTE_TEXT = "Last touched three weeks ago. Shipped twice since.";
const DOCK_HINT = "← go on, stick one anywhere";
const TURN_HINT = "↑ your turn: click a screen and leave a comment";
const HAND_TEXT = encodeURIComponent([...new Set([...(NOTE_TEXT + DOCK_HINT + TURN_HINT)])].join(""));

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface LandingOptions {
  /** The current Mac release, if one is published. */
  version?: string;
  /** When that release was published (ms since epoch). */
  releasedAt?: number;
  /** Public origin for canonical and share links, no trailing slash. */
  site: string;
  /** Render time; the page says "shipped today" relative to it. */
  now?: number;
}

export function landingHtml({ version, releasedAt, site, now = Date.now() }: LandingOptions): string {
  const origin = site.replace(/\/+$/, "");
  const macLabel = version ? `Mac app v${version} for Apple silicon` : "Mac app for Apple silicon";
  let shipped = "";
  if (version && releasedAt) {
    const d = new Date(releasedAt);
    const days = Math.floor(now / 86_400_000) - Math.floor(releasedAt / 86_400_000);
    const when = days <= 0 ? "today" : days === 1 ? "yesterday" : `on ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
    shipped = `<p class="shipped"><i aria-hidden="true"></i><span>Version ${version}, shipped <span id="shipped" data-at="${releasedAt}">${when}</span>.</span></p>`;
  }
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Commons: design on the product, not pictures of it</title>
<meta name="description" content="Commons puts your running app on a shared canvas. Comment on the real screens, hand feedback to a coding agent, and get a working draft back with the reasoning attached." />
<link rel="canonical" href="${origin}/" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="Commons" />
<meta property="og:url" content="${origin}/" />
<meta property="og:title" content="Commons: design on the product, not pictures of it" />
<meta property="og:description" content="One canvas for the whole team, showing the app that actually runs. Comment on real screens, turn feedback into drafts, keep the why with receipts." />
<meta property="og:image" content="${origin}/og.jpg" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta property="og:image:alt" content="Commons: two phone screens on a shared canvas, one with a comment pin and one showing the agent's draft." />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="Commons: design on the product, not pictures of it" />
<meta name="twitter:description" content="Comment on the running app, hand it to an agent, and get a working draft back." />
<meta name="twitter:image" content="${origin}/og.jpg" />
<meta name="theme-color" content="#fbf9f4" />
<script type="application/ld+json">{"@context":"https://schema.org","@type":"SoftwareApplication","name":"Commons","url":"${origin}/","applicationCategory":"DesignApplication","operatingSystem":"macOS, Web","description":"A shared canvas showing your running app. Comment on real screens, hand feedback to a coding agent, and get a working draft back.","offers":{"@type":"Offer","price":"0","priceCurrency":"USD","description":"Free while in preview"}}</script>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='9' fill='%2326251e'/%3E%3Cpath d='M21.5 11.5a6 6 0 1 0 0 9' fill='none' stroke='%23d98a54' stroke-width='3' stroke-linecap='round'/%3E%3C/svg%3E" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght,SOFT,WONK@9..144,600,100,1&display=swap" />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700&display=swap" />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Shantell+Sans:wght@500&display=swap&text=${HAND_TEXT}" />
<style>
  :root {
    --page: #fbf9f4;
    --sand: #f3f0e8;
    --dot: #d9d3c3;
    --line: #e6e2d6;
    --line-2: #d8d3c4;
    --line-3: #beb8a5;
    --ink: #26251e;
    --ink-2: #5c5a4f;
    --ink-3: #6b695e;
    --tool: #26251e;
    --tool-2: #33342c;
    --tool-line: #46473d;
    --tool-ink: #edebe0;
    --tool-ink-2: #b3b1a5;
    --ember: #d98a54;
    --ember-deep: #c8743f;
    --ember-ink: #9c531f;
    --bronze: #b8823a;
    --live: #3f9a5a;
    --blue-t: #e2eaf6;
    --amber-t: #f6e9cc;
    --ember-t: #f8e3d2;
    --teal-t: #d6ece7;
    --green-t: #dcefdf;
    --sticky: #f3d57a;
    --maya: #5b86e5;
    --dev: #3f9a5a;
    --app: #2f5d55;
    --display: "Fraunces", "Iowan Old Style", Georgia, serif;
    --sans: "Figtree", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    --hand: "Shantell Sans", "Marker Felt", "Comic Sans MS", cursive;
    --mono: ui-monospace, "SF Mono", SFMono-Regular, Menlo, monospace;
    --soft: 0 1px 2px rgba(60, 50, 25, 0.06), 0 12px 32px rgba(60, 50, 25, 0.1), 0 32px 64px rgba(60, 50, 25, 0.08);
    --ease: cubic-bezier(0.2, 0.8, 0.2, 1);
    --spring: cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; }
  body {
    margin: 0; color: var(--ink); font: 17.5px/1.6 var(--sans);
    background-color: var(--page);
    background-image: radial-gradient(circle, var(--dot) 1.2px, transparent 1.4px);
    background-size: 24px 24px; background-attachment: fixed;
    -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility;
    overflow-x: clip; padding-bottom: 88px;
  }
  ::selection { background: rgba(217, 138, 84, 0.35); }
  a { color: inherit; }
  :focus-visible { outline: 2.5px solid var(--ember-ink); outline-offset: 3px; border-radius: 8px; }
  .wrap { max-width: 1240px; margin: 0 auto; padding: 0 32px; }
  .vh { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }

  /* The canvas dot glow, in ember: the grid warms up around the pointer. */
  .glow {
    position: fixed; inset: 0; pointer-events: none; z-index: 0;
    background-image: radial-gradient(circle, var(--ember) 1.6px, transparent 1.9px);
    background-size: 24px 24px; background-attachment: fixed;
    -webkit-mask-image: radial-gradient(circle 130px at var(--mx, -500px) var(--my, -500px), #000 0%, transparent 100%);
            mask-image: radial-gradient(circle 130px at var(--mx, -500px) var(--my, -500px), #000 0%, transparent 100%);
    opacity: 0; transition: opacity 300ms var(--ease);
  }
  .glow.on { opacity: 0.7; }
  @media (hover: none) { .glow { display: none; } }
  main, header, footer { position: relative; z-index: 1; }

  /* ── Top bar ─────────────────────────────────────────── */
  .bar {
    position: sticky; top: 0; z-index: 30;
    background: rgba(251, 249, 244, 0.82);
    backdrop-filter: saturate(150%) blur(14px); -webkit-backdrop-filter: saturate(150%) blur(14px);
    border-bottom: 1.5px solid transparent; transition: border-color 220ms var(--ease);
  }
  .bar.stuck { border-bottom-color: var(--line-2); }
  .bar .wrap { display: flex; align-items: center; gap: 28px; height: 70px; }
  .brand { display: flex; align-items: center; gap: 10px; text-decoration: none; color: var(--ink);
           font-family: var(--display); font-size: 25px; font-weight: 600;
           font-variation-settings: "opsz" 36, "SOFT" 100, "WONK" 1; letter-spacing: -0.01em; }
  .bar nav { display: flex; gap: 4px; margin-left: auto; }
  .bar nav a { text-decoration: none; color: var(--ink-2); font-size: 15.5px; font-weight: 500; padding: 7px 12px; border-radius: 10px;
               transition: color 140ms var(--ease), background 140ms var(--ease); }
  .bar nav a:hover { color: var(--ink); background: rgba(38, 37, 30, 0.06); }

  /* ── Buttons: tactile, with an ink edge, and they sink when pressed ── */
  .btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 8px;
    font: 600 16px/1 var(--sans); text-decoration: none; white-space: nowrap; cursor: pointer;
    padding: 13px 22px; border-radius: 14px; border: 2px solid var(--ink); color: var(--ink);
    box-shadow: 0 4px 0 var(--ink); transform: translateY(0);
    transition: transform 120ms var(--ease), box-shadow 120ms var(--ease), background 160ms var(--ease);
  }
  .btn:hover { transform: translateY(-1px); box-shadow: 0 5px 0 var(--ink); }
  .btn:active { transform: translateY(3px); box-shadow: 0 1px 0 var(--ink); }
  .btn:disabled { opacity: 0.45; cursor: default; transform: none; box-shadow: 0 4px 0 var(--ink); }
  .btn.do { background: var(--ember); }
  .btn.do:hover { background: #e39a68; }
  .btn.alt { background: #fff; }
  .btn.alt:hover { background: var(--sand); }
  .btn.big { padding: 16px 26px; font-size: 17px; border-radius: 16px; }
  .btn.sm { padding: 9px 14px; font-size: 14.5px; border-radius: 11px; box-shadow: 0 3px 0 var(--ink); }
  .btn.sm:hover { box-shadow: 0 4px 0 var(--ink); }
  .btn.sm:active { box-shadow: 0 1px 0 var(--ink); transform: translateY(2px); }
  .bar .btn { padding: 9px 16px; font-size: 15px; border-radius: 12px; box-shadow: 0 3px 0 var(--ink); }
  .bar .btn:hover { box-shadow: 0 4px 0 var(--ink); }
  .bar .btn:active { box-shadow: 0 1px 0 var(--ink); transform: translateY(2px); }

  /* ── Type ────────────────────────────────────────────── */
  h1, h2, h3 { font-family: var(--display); font-weight: 600; letter-spacing: -0.02em; text-wrap: balance; margin: 0;
               font-variation-settings: "opsz" 144, "SOFT" 100, "WONK" 1; }
  h1 { font-size: clamp(50px, 5.8vw, 88px); line-height: 0.98; }
  h2 { font-size: clamp(38px, 4.4vw, 62px); line-height: 1.02; }
  h3 { font-size: clamp(28px, 2.5vw, 36px); line-height: 1.08; font-variation-settings: "opsz" 72, "SOFT" 100, "WONK" 1; }
  .lede { font-size: clamp(18.5px, 1.6vw, 21px); line-height: 1.55; color: var(--ink-2); max-width: 46ch; text-wrap: pretty; margin: 24px 0 0; }
  .route { font-family: var(--mono); font-size: 12px; color: var(--ink-3); }
  section { padding: 120px 0; }

  /* Marker markup: drawn once, on load. */
  .mk { position: relative; white-space: nowrap; display: inline-block; }
  .mk svg { position: absolute; left: -9%; top: -14%; width: 118%; height: 130%; overflow: visible; pointer-events: none; }
  .mk path { fill: none; stroke: var(--ember-deep); stroke-width: 3.2; stroke-linecap: round; stroke-linejoin: round;
             stroke-dasharray: 1; stroke-dashoffset: 1; animation: draw 1000ms 450ms var(--ease) forwards; }
  @keyframes draw { to { stroke-dashoffset: 0; } }

  /* Die-cut stickers: the emoji with a white edge and a soft drop. */
  .stk { font-size: 38px; line-height: 1; display: inline-block; user-select: none; -webkit-user-select: none;
         filter: drop-shadow(1.6px 0 0 #fff) drop-shadow(-1.6px 0 0 #fff) drop-shadow(0 1.6px 0 #fff) drop-shadow(0 -1.6px 0 #fff) drop-shadow(0 5px 7px rgba(60, 50, 25, 0.28)); }
  .stuck { position: absolute; transform: rotate(var(--r, -8deg)); z-index: 3; }

  /* ── Hero ────────────────────────────────────────────── */
  .hero { padding: 64px 0 96px; }
  .hero .wrap { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 48px; align-items: center; }
  .hero h1 { max-width: 13ch; }
  .actions { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 36px; }
  .small { margin: 20px 0 0; color: var(--ink-3); font-size: 15px; max-width: 46ch; }
  .shipped { display: flex; align-items: center; gap: 9px; margin: 10px 0 0; font-size: 15px; color: var(--ink-3); }
  .shipped i { width: 8px; height: 8px; border-radius: 50%; background: var(--live); box-shadow: 0 0 0 4px rgba(63, 154, 90, 0.18); flex-shrink: 0; }

  /* The scene: a live canvas moment on the page's own grid, sized in
     container units so it scales like an image. */
  .scene { position: relative; container-type: inline-size; }
  .stage { position: relative; width: 100%; aspect-ratio: 100 / 86; }
  .stage > * { position: absolute; }
  .fh { display: flex; align-items: baseline; gap: 1.2cqi; font-size: 1.9cqi; color: var(--ink-2); white-space: nowrap; }
  .fh b { color: var(--ink); font-weight: 600; }
  .fh .route { font-size: 1.55cqi; }
  .fh .badge { font-size: 1.45cqi; font-weight: 700; color: var(--ember-ink); padding: 0.25cqi 1cqi; border-radius: 99px; background: var(--ember-t); }
  .ph {
    width: 28cqi; aspect-ratio: 0.48; border-radius: 3.6cqi; background: #fff; color: #1f2a28;
    box-shadow: 0 0 0 0.45cqi var(--ink), 0 1.2cqi 0 0.45cqi rgba(38, 37, 30, 0.9), 0 3cqi 6cqi rgba(60, 50, 25, 0.18);
    overflow: hidden; padding: 2.2cqi 2cqi; display: flex; flex-direction: column; gap: 1.4cqi; font-size: 1.45cqi; line-height: 1.3;
  }
  .ph .top { display: flex; justify-content: space-between; font-weight: 700; font-size: 1.25cqi; }
  .ph .top i { width: 5cqi; height: 1.1cqi; border-radius: 1cqi; background: #d9ddd8; display: block; }
  .ph .hi { color: #6a7672; }
  .ph .lbl { color: #6a7672; font-size: 1.35cqi; margin-top: 0.6cqi; }
  .ph .amt { font-size: 3.7cqi; font-weight: 700; letter-spacing: -0.02em; line-height: 1; margin-top: -0.6cqi; }
  .ph .row { display: flex; justify-content: space-between; align-items: center; padding: 1.1cqi 1.3cqi;
             border-radius: 1.4cqi; background: #eef2ef; font-size: 1.35cqi; }
  .ph .row b { font-weight: 700; }
  .ph .btns { display: grid; grid-template-columns: 1fr 1fr; gap: 1cqi; }
  .ph .btns span { background: var(--app); color: #fff; border-radius: 99px; text-align: center; padding: 1cqi 0; font-weight: 700; font-size: 1.35cqi; }
  .ph .btns span + span { background: #e3ebe8; color: var(--app); }
  .ph .li { display: flex; gap: 1.2cqi; align-items: center; }
  .ph .li i { width: 3.4cqi; height: 3.4cqi; border-radius: 50%; background: #e3ebe8; flex-shrink: 0; display: block; }
  .ph .li span { flex: 1; display: grid; gap: 0.7cqi; }
  .ph .li span s { display: block; height: 0.9cqi; border-radius: 1cqi; background: #e6e9e6; text-decoration: none; }
  .ph .li span s + s { width: 55%; }
  .ph .to { align-self: flex-start; background: #eef2ef; border-radius: 99px; padding: 0.6cqi 1.4cqi; color: #3f4c49; }
  .ph .big { font-size: 6.6cqi; font-weight: 700; letter-spacing: -0.03em; text-align: center; margin: 1.6cqi 0 0.4cqi; }
  .ph .keys { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1cqi; margin-top: auto; }
  .ph .keys i { height: 4cqi; border-radius: 1.2cqi; background: #f1f3f1; display: flex; align-items: center; justify-content: center;
                font-style: normal; font-weight: 600; color: #3f4c49; }
  .ph .go { background: var(--app); color: #fff; border-radius: 99px; text-align: center; padding: 1.1cqi 0; font-weight: 700; }
  .ph .changed { transition: box-shadow 400ms var(--ease); border-radius: 1cqi; }
  .slot { width: 28cqi; aspect-ratio: 0.48; border-radius: 3.6cqi; border: 0.3cqi dashed var(--line-3); transition: opacity 400ms var(--ease); }
  .scene[data-s~="draft"] .slot, .scene[data-s~="yourdraft"] .slot { opacity: 0; }
  .hl { position: absolute; width: 12cqi; height: 12cqi; margin: -6cqi 0 0 -6cqi; border-radius: 50%;
        border: 0.55cqi solid var(--ember-deep); background: rgba(217, 138, 84, 0.12);
        opacity: 0; transform: scale(1.8); transition: opacity 300ms var(--ease), transform 520ms var(--spring); }
  .scene[data-s~="yhl"] .hl { opacity: 1; transform: none; }

  .pin {
    width: 4.4cqi; height: 4.4cqi; border-radius: 50% 50% 50% 0.6cqi; background: var(--bronze); color: #fff;
    font-weight: 700; font-size: 1.7cqi; display: flex; align-items: center; justify-content: center;
    box-shadow: 0 0 0 0.45cqi #fff, 0 1cqi 2cqi rgba(60, 50, 25, 0.35);
  }
  .card {
    background: var(--tool); border-radius: 1.8cqi; color: var(--tool-ink); padding: 1.7cqi; font-size: 1.6cqi; line-height: 1.4;
    box-shadow: 0 1.4cqi 3.6cqi rgba(38, 37, 30, 0.3);
  }
  .msg + .msg { margin-top: 1.3cqi; padding-top: 1.3cqi; border-top: 1px solid var(--tool-line); }
  .msg .who { font-weight: 700; font-size: 1.45cqi; margin-bottom: 0.5cqi; display: flex; gap: 0.8cqi; align-items: center; }
  .msg .who i { width: 1.4cqi; height: 1.4cqi; border-radius: 50%; display: block; }
  .msg p { margin: 0; color: var(--tool-ink-2); }
  .send { display: inline-flex; margin-top: 1.4cqi; padding: 0.8cqi 1.4cqi; border-radius: 1cqi; background: rgba(217, 138, 84, 0.18);
          color: var(--ember); font-weight: 700; font-size: 1.45cqi; transition: background 200ms var(--ease), color 200ms var(--ease); }
  .agent .br { font-family: var(--mono); font-size: 1.35cqi; color: var(--tool-ink-2); display: flex; gap: 0.8cqi; align-items: center; margin-bottom: 1.1cqi; }
  .agent .br i { width: 1.2cqi; height: 1.2cqi; border-radius: 50%; background: var(--ember); display: block; animation: breathe 1.6s ease-in-out infinite; }
  .agent .ln { font-size: 1.45cqi; color: var(--tool-ink-2); display: flex; gap: 0.9cqi; margin-top: 0.7cqi; }
  .agent .ln .ok { color: #7fcf95; }
  .agent .ln .ready { display: none; color: #7fcf95; }
  .cur { display: flex; align-items: flex-start; gap: 0.2cqi; left: 0; top: 0; z-index: 6;
         transition: transform 1100ms var(--ease), opacity 400ms var(--ease); will-change: transform; }
  .cur svg { width: 2.8cqi; height: 2.8cqi; display: block; }
  .cur span { margin-top: 2.1cqi; padding: 0.35cqi 1.1cqi; border-radius: 1cqi; font-size: 1.45cqi; font-weight: 700; color: #fff; }
  .c-maya { color: var(--maya); } .c-maya span { background: var(--maya); }
  .c-dev { color: var(--dev); } .c-dev span { background: var(--dev); }
  .pop { font-size: 6.4cqi; z-index: 5; }

  /* Scene choreography: JS adds tokens to data-s; each element answers one. */
  .step { opacity: 0; transition: opacity 420ms var(--ease), transform 520ms var(--ease); }
  .pin.step { transform: scale(0.3) translateY(-3cqi); transform-origin: 20% 100%; transition: opacity 300ms var(--ease), transform 460ms var(--spring); }
  .thread.step, .agent.step { transform: translateY(1.4cqi) scale(0.98); }
  .reply.step { transform: none; }
  .draft.step, .yours.step { transform: translateX(-5cqi) rotate(-3deg) scale(0.96); transition: opacity 420ms var(--ease), transform 640ms var(--spring); }
  .pop.step { transform: scale(2.2) rotate(var(--r)); transition: opacity 180ms var(--ease), transform 520ms var(--spring); }
  .scene[data-s~="pin"] .pin.auto,
  .scene[data-s~="mypin"] .pin.mine,
  .scene[data-s~="thread"] .thread,
  .scene[data-s~="reply"] .reply,
  .scene[data-s~="agent"] .agent,
  .scene[data-s~="a1"] .a1,
  .scene[data-s~="a2"] .a2,
  .scene[data-s~="a3"] .a3,
  .scene[data-s~="draft"] .draft,
  .scene[data-s~="yourdraft"] .yours { opacity: 1; transform: none; }
  .scene[data-s~="fire"] .pop.fire,
  .scene[data-s~="party"] .pop.party { opacity: 1; transform: scale(1) rotate(var(--r)); }
  .scene[data-s~="send"] .send { background: var(--ember); color: var(--ink); }
  .scene[data-s~="ready"] .agent .ln .ready { display: inline; }
  .scene[data-s~="ready"] .agent .ln .wait { display: none; }
  .scene[data-s~="ready"] .agent .br i { animation: none; background: #7fcf95; }
  .scene[data-s~="diff"] .draft .changed { box-shadow: 0 0 0 0.45cqi rgba(217, 138, 84, 0.75); }
  .scene[data-s~="out"] .step, .scene[data-s~="out"] .cur { opacity: 0; }
  .scene[data-s~="reset"] .cur, .scene[data-s~="reset"] .step, .scene[data-s~="reset"] .hl { transition: none; }
  .settle { animation: settle 900ms var(--ease) both; }
  .settle.s2 { animation-delay: 120ms; }
  @keyframes settle { from { opacity: 0; transform: translateY(2.4cqi); } }
  @keyframes breathe { 50% { opacity: 0.35; } }

  /* Your turn: the phones are buttons, the comment box is a real one. */
  .hit { position: absolute; z-index: 4; padding: 0; border: 0; background: transparent; border-radius: 3.6cqi; cursor: pointer;
         transition: box-shadow 200ms var(--ease); }
  .hit:hover { box-shadow: 0 0 0 0.7cqi rgba(217, 138, 84, 0.55); }
  .hit:focus-visible { outline: none; box-shadow: 0 0 0 0.7cqi var(--ember-ink); }
  .scene[data-s~="locked"] .hit { pointer-events: none; }
  .turn { margin: 1.5cqi 0 0; text-align: center; font-family: var(--hand); font-weight: 500; font-size: 17px; color: var(--ink-2);
          transform: rotate(-1deg); animation: turnin 600ms 2200ms var(--ease) both; transition: opacity 300ms var(--ease); }
  .scene[data-s~="mine"] .turn { opacity: 0; }
  @keyframes turnin { from { opacity: 0; transform: translateY(6px) rotate(-1deg); } }
  .composer {
    position: absolute; z-index: 8; width: min(310px, calc(100% - 16px)); padding: 14px;
    background: #fff; border: 2px solid var(--ink); border-radius: 16px; box-shadow: 0 5px 0 var(--ink), 0 18px 36px rgba(60, 50, 25, 0.22);
    font-size: 15px; line-height: 1.45; animation: pop 320ms var(--spring);
  }
  @keyframes pop { from { opacity: 0; transform: scale(0.94) translateY(6px); } }
  .composer.aside { width: 262px; }
  .composer.below { position: relative; left: auto; top: auto; width: auto; margin: 12px 0 0; }
  .cm-head { display: flex; align-items: center; gap: 9px; font-size: 14px; color: var(--ink-2); margin-bottom: 10px; }
  .cm-head b { color: var(--ink); }
  .cm-me { width: 24px; height: 24px; border-radius: 50% 50% 50% 4px; background: var(--bronze); color: #fff; font-weight: 700;
           font-size: 12px; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .composer textarea { display: block; width: 100%; resize: none; font: 16px/1.4 var(--sans); color: var(--ink);
                       border: 1.5px solid var(--line-2); border-radius: 10px; padding: 9px 11px; background: var(--page); }
  .composer textarea:focus { outline: none; border-color: var(--ember-deep); box-shadow: 0 0 0 3px rgba(217, 138, 84, 0.25); }
  .cm-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 9px; }
  .cm-chips button { font: 500 13px/1 var(--sans); color: var(--ink-2); background: var(--sand); border: 1px solid var(--line-2);
                     border-radius: 99px; padding: 7px 10px; cursor: pointer; }
  .cm-chips button:hover { color: var(--ink); border-color: var(--line-3); }
  .cm-acts { display: flex; align-items: center; justify-content: flex-end; gap: 10px; margin-top: 12px; }
  .cm-link { font: 600 14px/1 var(--sans); color: var(--ink-2); background: none; border: 0; padding: 8px 4px; cursor: pointer; text-decoration: underline; text-underline-offset: 3px; }
  .cm-link:hover { color: var(--ink); }
  .cm-quote { margin: 0; padding: 9px 11px; border-radius: 10px; background: var(--sand); color: var(--ink); overflow-wrap: anywhere; }
  .cm-status { margin: 10px 0 0; font-weight: 600; color: var(--ember-ink); }
  .cm-big { margin: 0; font-family: var(--display); font-weight: 600; font-size: 22px; line-height: 1.15;
            font-variation-settings: "opsz" 36, "SOFT" 100, "WONK" 1; }
  .cm-note { margin: 6px 0 0; color: var(--ink-2); font-size: 14.5px; }
  .composer[data-state="write"] .cm-sent, .composer[data-state="write"] .cm-done,
  .composer[data-state="sent"] .cm-write, .composer[data-state="sent"] .cm-done,
  .composer[data-state="done"] .cm-write, .composer[data-state="done"] .cm-sent, .composer[data-state="done"] .cm-head { display: none; }

  /* ── Works with: name tags stuck on at angles ────────── */
  .works { padding: 8px 0 0; }
  .works .wrap { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
  .works .lead { color: var(--ink-3); font-size: 15.5px; margin-right: 6px; }
  .tag { display: inline-block; padding: 7px 14px; border-radius: 10px; border: 1.5px solid var(--ink); background: #fff;
         font-weight: 600; font-size: 15px; box-shadow: 0 2px 0 var(--ink); transform: rotate(var(--r, 0deg)); }
  .tag:nth-child(3n+2) { --r: -2deg; background: var(--blue-t); }
  .tag:nth-child(3n) { --r: 1.5deg; background: var(--amber-t); }
  .tag:nth-child(3n+1) { --r: -1deg; background: var(--teal-t); }

  /* ── Stale vs live ───────────────────────────────────── */
  .stale .wrap { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 64px; align-items: center; }
  .stale h2 { max-width: 12ch; }
  .exhibit { position: relative; height: 460px; }
  .mock {
    position: absolute; left: 4%; top: 40px; width: 56%; height: 340px; border-radius: 16px;
    background: #e4dfd1; transform: rotate(-5deg); filter: grayscale(0.7); opacity: 0.8;
    box-shadow: var(--soft); padding: 22px; display: grid; gap: 12px; align-content: start; border: 1.5px solid var(--line-3);
  }
  .mock s { display: block; height: 11px; border-radius: 6px; background: #c8c1ad; text-decoration: none; }
  .mock s.w6 { width: 60%; } .mock s.w8 { width: 80%; } .mock s.w4 { width: 40%; }
  .mock s.blk { height: 90px; border-radius: 10px; }
  .mock .file { font-family: var(--mono); font-size: 12px; color: #5f5a4e; margin-bottom: 4px; }
  .note-y {
    position: absolute; left: 12%; top: 300px; width: 196px; padding: 16px 18px 18px; background: var(--sticky); color: #3a3120;
    font-family: var(--hand); font-weight: 500; font-size: 17px; line-height: 1.3; transform: rotate(4deg);
    box-shadow: 0 14px 24px rgba(60, 50, 25, 0.22); border-radius: 4px 4px 14px 4px; z-index: 2;
  }
  .livebox { position: absolute; right: 2%; top: 10px; width: 36%; }
  .livebox .fh { font-size: 14px; gap: 10px; margin-bottom: 12px; }
  .livebox .fh .route { font-size: 12px; }
  .livebox .fh .on { display: inline-flex; align-items: center; gap: 6px; color: var(--live); font-size: 13px; font-weight: 700; margin-left: auto; }
  .livebox .fh .on i { width: 8px; height: 8px; border-radius: 50%; background: var(--live); box-shadow: 0 0 0 4px rgba(63, 154, 90, 0.2); display: block; }
  .ph2 {
    border-radius: 28px; background: #fff; color: #1f2a28; box-shadow: 0 0 0 4px var(--ink), 0 10px 0 4px rgba(38, 37, 30, 0.9), 0 28px 48px rgba(60, 50, 25, 0.2);
    aspect-ratio: 0.54; padding: 22px 18px; display: flex; flex-direction: column; gap: 12px; font-size: 13.5px;
  }
  .ph2 .t { font-weight: 700; font-size: 15.5px; }
  .ph2 .line { display: flex; justify-content: space-between; color: #3f4c49; }
  .ph2 hr { border: 0; height: 1px; background: #e6e9e6; margin: 2px 0; width: 100%; }
  .ph2 .tot { display: flex; justify-content: space-between; font-weight: 700; font-size: 15.5px; }
  .ph2 .pay { margin-top: auto; background: var(--app); color: #fff; border-radius: 99px; text-align: center; padding: 12px 0; font-weight: 700; }

  /* ── The flow: five tinted frames, joined like Flow joins screens ── */
  .flow-head { max-width: 760px; }
  .frames { margin-top: 72px; display: grid; }
  .fr { width: min(920px, 100%); position: relative; }
  .fr.r { justify-self: end; }
  .fr > .fh { font-size: 14.5px; gap: 10px; margin: 0 0 10px 6px; }
  .fr > .fh .route { font-size: 12.5px; }
  .fr > .stuck { top: 18px; right: -16px; }
  .sheet {
    background: #fff; color: var(--ink); border-radius: 22px; border: 1.5px solid var(--ink); box-shadow: 0 6px 0 var(--ink);
    display: grid; grid-template-columns: minmax(0, 1.08fr) minmax(0, 0.92fr); gap: 44px; padding: 44px 44px 44px 48px; align-items: center;
  }
  .fr.c1 .sheet { background: var(--blue-t); }
  .fr.c2 .sheet { background: var(--amber-t); }
  .fr.c3 .sheet { background: var(--ember-t); }
  .fr.c4 .sheet { background: var(--teal-t); }
  .fr.c5 .sheet { background: var(--green-t); }
  .sheet p { margin: 14px 0 0; color: var(--ink-2); font-size: 17px; text-wrap: pretty; }
  .sheet ul { margin: 18px 0 0; padding: 0; list-style: none; }
  .sheet li { position: relative; padding-left: 22px; margin-top: 8px; color: var(--ink-2); font-size: 16px; }
  .sheet li::before { content: ""; position: absolute; left: 3px; top: 9px; width: 8px; height: 8px; border-radius: 50%; border: 1.5px solid var(--ink); background: #fff; }
  .edge { height: 110px; position: relative; }
  .edge svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
  .edge path { fill: none; stroke: var(--ink); stroke-width: 2; stroke-dasharray: 2 8; stroke-linecap: round; vector-effect: non-scaling-stroke; }
  .edge .tip { position: absolute; width: 12px; height: 12px; border-radius: 50%; background: var(--ink);
               box-shadow: 0 0 0 4px var(--page); transform: translate(-50%, -50%); }

  /* Vignettes: small pieces of Commons UI inside each frame. */
  .vig { background: var(--tool); color: var(--tool-ink); border-radius: 16px; padding: 18px; font-size: 14px; line-height: 1.45;
         box-shadow: 0 12px 28px rgba(38, 37, 30, 0.25); }
  .vig .row { display: flex; align-items: center; gap: 10px; padding: 9px 0; border-bottom: 1px solid var(--tool-2); }
  .vig .row:last-child { border-bottom: 0; }
  .vig .mono { font-family: var(--mono); font-size: 12px; color: var(--tool-ink-2); }
  .vig .ok { color: #7fcf95; }
  .vig .dim { color: #9a988b; }
  .vig .pct { margin-left: auto; font-weight: 700; color: #7fcf95; white-space: nowrap; }
  .vig .pct.low { color: #f0c060; }
  .vig .chip { white-space: nowrap; display: inline-flex; align-items: center; gap: 6px; padding: 5px 11px; border-radius: 8px; background: var(--tool-2);
               font-size: 12.5px; color: var(--tool-ink-2); }
  .vig .chip i { width: 7px; height: 7px; border-radius: 50%; background: #7fcf95; display: block; }
  .vig .act { display: inline-flex; padding: 6px 12px; border-radius: 8px; background: var(--ember); color: var(--ink); font-weight: 700; font-size: 12.5px; }
  .minis { display: flex; gap: 10px; margin-top: 14px; }
  .minis > div { flex: 1; background: #fff; border-radius: 9px; aspect-ratio: 0.62; padding: 8px; display: grid; gap: 5px; align-content: start; }
  .minis s { display: block; height: 5px; border-radius: 3px; background: #e2e6e2; text-decoration: none; }
  .minis s.a { background: var(--app); width: 50%; opacity: 0.8; }
  .minis s.b { height: 22px; border-radius: 5px; background: #eef2ef; }
  .minis .fhm { font-size: 10.5px; color: #5f6b67; display: flex; align-items: center; gap: 5px; margin-bottom: 6px; }
  .minis .fhm i { width: 6px; height: 6px; border-radius: 50%; background: var(--live); display: block; }
  .thr .m + .m { margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--tool-2); }
  .thr .who { font-weight: 700; font-size: 12.5px; display: flex; gap: 7px; align-items: center; margin-bottom: 3px; }
  .thr .who i { width: 8px; height: 8px; border-radius: 50%; display: block; }
  .thr .who .g { font-weight: 500; color: #9a988b; }
  .thr p { margin: 0; color: var(--tool-ink-2); font-size: 13.5px; }
  .heat { position: relative; height: 84px; border-radius: 9px; background: #fff; margin-top: 12px; overflow: hidden; }
  .heat s { position: absolute; left: 10%; right: 10%; height: 6px; border-radius: 3px; background: #e6e9e6; text-decoration: none; }
  .heat i { position: absolute; width: 16px; height: 16px; border-radius: 50%; background: radial-gradient(circle, rgba(232, 150, 50, 0.95), rgba(232, 150, 50, 0) 70%); display: block; }
  .note { border-left: 3px solid var(--ember); padding: 2px 0 2px 12px; color: var(--tool-ink-2); font-size: 13.5px; }
  .note + .note { margin-top: 14px; }
  .cite { display: inline-block; margin: 8px 6px 0 0; padding: 2px 9px; border: 1px solid var(--tool-line); border-radius: 99px; font-size: 11.5px; color: #a3a195; }
  .cite.guess { border-style: dashed; border-color: #a07c34; color: #f0c060; }

  /* Mid-page door. */
  .start { margin-top: 110px; }
  .start .sheet { grid-template-columns: 1fr auto; padding: 34px 38px; gap: 24px; background: #fff; }
  .start h3 { font-size: clamp(26px, 2.4vw, 34px); }
  .start p { margin-top: 6px; font-size: 16px; }

  /* ── Roles: the app's segmented control ─────────────── */
  .roles-head { max-width: 800px; }
  .seg { display: inline-flex; margin-top: 40px; padding: 5px; border-radius: 16px; background: #fff; border: 1.5px solid var(--ink); box-shadow: 0 3px 0 var(--ink); }
  .seg button { font: 600 15.5px/1 var(--sans); color: var(--ink-2); background: transparent; border: 0; cursor: pointer;
                padding: 12px 20px; border-radius: 11px; transition: background 180ms var(--ease), color 180ms var(--ease); }
  .seg button:hover { color: var(--ink); background: var(--sand); }
  .seg button[aria-selected="true"] { background: var(--ink); color: var(--page); }
  .role { margin-top: 22px; }
  .role .sheet { grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.2fr); align-items: start; background: #fff; }
  .role .sheet ul { margin: 0; }
  .role .sheet li { font-size: 16.5px; margin-top: 12px; }
  .role .sheet li:first-child { margin-top: 2px; }
  .role[hidden] { display: none; }
  .role .sheet { animation: swap 380ms var(--spring); }
  @keyframes swap { from { opacity: 0; transform: translateY(8px) rotate(-0.6deg); } }

  /* ── FAQ ─────────────────────────────────────────────── */
  .faq .sheet { display: block; padding: 10px 40px; max-width: 900px; background: #fff; }
  details { border-bottom: 1.5px dashed var(--line-2); }
  details:last-child { border-bottom: 0; }
  summary { cursor: pointer; list-style: none; display: flex; align-items: baseline; gap: 16px; padding: 22px 0;
            font-family: var(--display); font-weight: 600; font-size: 23px; line-height: 1.25;
            font-variation-settings: "opsz" 36, "SOFT" 100, "WONK" 1; }
  summary::-webkit-details-marker { display: none; }
  summary::after { content: "+"; margin-left: auto; font-family: var(--sans); font-size: 26px; font-weight: 500; color: var(--ember-deep); transition: transform 260ms var(--spring); }
  details[open] summary::after { transform: rotate(45deg); }
  summary:hover { color: var(--ember-ink); }
  details p { margin: -6px 0 22px; color: var(--ink-2); font-size: 16.5px; max-width: 66ch; }

  /* ── Close: a full ember field, stickers on it ───────── */
  .close {
    margin-top: 40px; padding: 140px 0 130px; text-align: center; position: relative; overflow: hidden;
    background-color: var(--ember);
    background-image: radial-gradient(circle, rgba(38, 37, 30, 0.2) 1.3px, transparent 1.5px);
    background-size: 24px 24px; border-top: 2px solid var(--ink); border-bottom: 2px solid var(--ink);
  }
  .close .wrap { position: relative; }
  .close h2 { font-size: clamp(48px, 6.4vw, 96px); max-width: 13ch; margin: 0 auto; }
  .close .lede { margin: 22px auto 0; color: #3a2a1c; }
  .close .actions { justify-content: center; }
  .close .btn.do { background: var(--ink); color: var(--page); }
  .close .btn.do:hover { background: #3a3930; }
  .close .you { position: relative; display: inline-block; }
  .close .you .cur { position: absolute; left: 80%; top: 64%; color: #fff; pointer-events: none; }
  .close .you .cur svg { width: 20px; height: 20px; }
  .close .you .cur span { margin-top: 15px; font-size: 12.5px; padding: 3px 9px; border-radius: 7px; background: #fff; color: var(--ink); }
  .close .stk { font-size: 54px; }

  footer { padding: 44px 0 40px; color: var(--ink-3); font-size: 15px; }
  footer .wrap { display: flex; flex-wrap: wrap; gap: 20px 40px; align-items: center; }
  footer .brand { font-size: 21px; }
  footer nav { display: flex; flex-wrap: wrap; gap: 6px 24px; margin-left: auto; }
  footer a { text-decoration: none; color: var(--ink-2); font-weight: 500; }
  footer a:hover { color: var(--ink); }
  footer .v { width: 100%; font-size: 13.5px; margin: 0; }

  /* ── The sticker toy ─────────────────────────────────── */
  .dock {
    position: fixed; left: 50%; bottom: 18px; transform: translateX(-50%); z-index: 50;
    display: flex; align-items: center; gap: 2px; padding: 7px; border-radius: 20px;
    background: var(--tool); box-shadow: 0 4px 0 #000, 0 18px 40px rgba(38, 37, 30, 0.35);
  }
  .dock button { font-size: 25px; line-height: 1; width: 46px; height: 46px; border: 0; border-radius: 14px; cursor: pointer;
                 background: transparent; transition: background 140ms var(--ease), transform 200ms var(--spring); }
  .dock .stk-btn:hover { background: var(--tool-2); transform: translateY(-3px) rotate(-6deg) scale(1.12); }
  .dock .stk-btn[aria-pressed="true"] { background: var(--ember); transform: translateY(-3px) scale(1.12); }
  .dock-sep { width: 1px; height: 26px; background: var(--tool-line); margin: 0 5px; }
  .dock .dock-mute { color: var(--tool-ink-2); display: inline-flex; align-items: center; justify-content: center; }
  .dock .dock-mute:hover { background: var(--tool-2); color: var(--tool-ink); }
  .dock-mute svg { width: 20px; height: 20px; }
  .dock-mute .off, .dock-mute[aria-pressed="false"] .on { display: none; }
  .dock-mute[aria-pressed="false"] .off { display: block; }
  .dock .dock-done { width: auto; padding: 0 16px; margin-left: 4px; font: 700 15px/1 var(--sans); color: var(--ink); background: var(--ember); }
  .dock .dock-done:hover { background: #e39a68; }
  .dock-hint {
    position: absolute; left: calc(100% + 14px); top: 50%; transform: translateY(-50%) rotate(-3deg);
    font-family: var(--hand); font-weight: 500; font-size: 16.5px; color: var(--ink); white-space: nowrap; pointer-events: none;
    background: var(--sticky); padding: 6px 14px; border-radius: 10px; box-shadow: 0 6px 14px rgba(60, 50, 25, 0.2);
    transition: opacity 300ms var(--ease);
  }
  .dock-hint.gone { opacity: 0; }
  .layer { position: absolute; left: 0; top: 0; width: 0; height: 0; z-index: 40; }
  .placed { position: absolute; background: none; border: 0; padding: 0; cursor: pointer; font-size: 44px; line-height: 1;
            transform: translate(-50%, -50%) rotate(var(--r)); animation: slap 480ms var(--spring); }
  .placed.peel { animation: peel 260ms var(--ease) forwards; }
  @keyframes slap {
    0% { transform: translate(-50%, -50%) rotate(var(--r)) scale(1.9); opacity: 0; }
    55% { transform: translate(-50%, -50%) rotate(var(--r)) scale(1.14, 0.82); opacity: 1; }
    78% { transform: translate(-50%, -50%) rotate(var(--r)) scale(0.95, 1.06); }
    100% { transform: translate(-50%, -50%) rotate(var(--r)) scale(1); }
  }
  @keyframes peel { to { transform: translate(-40%, -80%) rotate(calc(var(--r) + 28deg)) scale(0.5); opacity: 0; } }
  .ghost { position: fixed; left: 0; top: 0; z-index: 60; pointer-events: none; font-size: 44px; line-height: 1; opacity: 0;
           margin: -22px 0 0 -22px; transition: opacity 150ms var(--ease); }
  body.sticking .ghost { opacity: 0.8; }
  body.sticking, body.sticking a, body.sticking .placed, body.sticking .hit { cursor: crosshair; }

  /* ── Reduced motion ──────────────────────────────────── */
  @media (prefers-reduced-motion: reduce) {
    html { scroll-behavior: auto; }
    .settle, .role .sheet, .placed, .placed.peel, .composer, .turn { animation: none; }
    .mk path { animation: none; stroke-dashoffset: 0; }
    .cur, .step, .hl, .btn, .dock button { transition: none; }
    .agent .br i { animation: none; }
  }

  /* ── Narrow screens ──────────────────────────────────── */
  @media (max-width: 980px) {
    section { padding: 84px 0; }
    .wrap { padding: 0 22px; }
    .bar nav { display: none; }
    .bar .btn.alt { display: none; }
    .bar .wrap { justify-content: space-between; }
    .hero { padding: 40px 0 64px; }
    .hero .wrap { grid-template-columns: 1fr; gap: 48px; }
    .stale .wrap { grid-template-columns: 1fr; gap: 36px; }
    .sheet { grid-template-columns: 1fr; padding: 28px 24px; gap: 24px; }
    .fr, .fr.r { justify-self: stretch; width: 100%; }
    .fr > .stuck { right: 6px; top: 10px; }
    .edge { height: 64px; }
    .edge svg { display: none; }
    .edge::before { content: ""; position: absolute; left: 50%; top: 0; bottom: 0; border-left: 2px dotted var(--ink); }
    .edge .tip { left: 50% !important; }
    .start .sheet { grid-template-columns: 1fr; }
    .role .sheet { grid-template-columns: 1fr; }
    .seg { display: flex; width: 100%; }
    .seg button { flex: 1; padding: 12px 6px; }
    .faq .sheet { padding: 6px 22px; }
    summary { font-size: 20px; }
    .close { padding: 100px 0 96px; }
    .close .you .cur { display: none; }
    .dock-hint { display: none; }
  }
  @media (max-width: 520px) {
    .exhibit { height: 380px; }
    .mock { height: 280px; }
    .note-y { left: 2%; top: 236px; width: 44%; font-size: 14.5px; }
    .livebox { width: 48%; }
    .livebox .fh .route { display: none; }
    .ph2 { padding: 16px 12px; gap: 8px; font-size: 11.5px; border-radius: 22px; }
    .ph2 .t, .ph2 .tot { font-size: 12.5px; }
    .turn { font-size: 15px; }
    .dock { bottom: 10px; padding: 5px; gap: 0; }
    .dock button { width: 34px; height: 40px; font-size: 20px; border-radius: 11px; }
    .dock-sep { margin: 0 3px; }
    .dock.sticking .dock-mute, .dock.sticking .dock-sep { display: none; }
    .dock .dock-done { padding: 0 12px; font-size: 14px; }
  }
</style>
</head>
<body>
<div class="glow" id="glow" aria-hidden="true"></div>
<p class="vh" id="sr" aria-live="polite"></p>

<header class="bar" id="bar">
  <div class="wrap">
    <a class="brand" href="/">${MARK(28)}Commons</a>
    <nav aria-label="Sections">
      <a href="#how">How it works</a>
      <a href="#roles">Who it's for</a>
      <a href="#faq">Questions</a>
    </nav>
    <a class="btn alt" href="${DOWNLOAD_URL}">Download for Mac</a>
    <a class="btn do" href="${APP_URL}">Open Commons</a>
  </div>
</header>

<main>

<!-- Hero: the claim, marked up; the loop playing beside it, then your turn. -->
<section class="hero">
  <div class="wrap">
    <div>
      <h1>Design on the <span class="mk">product,<svg viewBox="0 0 220 90" preserveAspectRatio="none" aria-hidden="true"><path pathLength="1" d="M34 20 C78 3, 172 1, 202 26 C224 45, 202 77, 130 85 C68 91, 10 78, 7 52 C4 29, 42 11, 98 7" /></svg></span> not pictures of it.</h1>
      <p class="lede">
        Commons puts your running app on a shared canvas. Your team comments on the real
        screens, hands the feedback to a coding agent, and gets a working draft back with the
        reasoning attached.
      </p>
      <div class="actions">
        <a class="btn do big" href="${APP_URL}">Open Commons in your browser</a>
        <a class="btn alt big" href="${DOWNLOAD_URL}">Download for Mac</a>
      </div>
      <p class="small">Free while in preview, no invite needed. Everything works in the browser, and the Mac app adds local dev servers and agents.</p>
      ${shipped}
    </div>

    <div class="scene" id="scene" data-s="reset" role="group" aria-label="Try it: leave a comment on one of these screens">
      <div class="stage" aria-hidden="true">
        <div class="fh settle" style="left:3cqi;top:1.5cqi"><b>Home</b><span class="route">/</span></div>
        <div class="ph settle" id="ph-home" style="left:3cqi;top:5.5cqi">
          <div class="top">9:41 <i></i></div>
          <div class="hi">Good morning, Ana</div>
          <div class="lbl">Balance</div>
          <div class="amt">$4,280.19</div>
          <div class="btns"><span>Send</span><span>Request</span></div>
          <div class="li"><i></i><span><s></s><s></s></span></div>
          <div class="li"><i></i><span><s></s><s></s></span></div>
          <div class="li"><i></i><span><s></s><s></s></span></div>
        </div>

        <div class="fh settle s2" style="left:35cqi;top:13cqi"><b>Send money</b><span class="route">/send</span></div>
        <div class="ph settle s2" id="ph-send" style="left:35cqi;top:17cqi">
          <div class="top">9:41 <i></i></div>
          <div class="to">To Jordan</div>
          <div class="big">$120</div>
          <div class="keys"><i>1</i><i>2</i><i>3</i><i>4</i><i>5</i><i>6</i><i>7</i><i>8</i><i>9</i><i>.</i><i>0</i><i>&lsaquo;</i></div>
          <div class="go">Continue</div>
        </div>

        <div class="slot" style="left:67cqi;top:5.5cqi"></div>
        <div class="fh draft step" style="left:67cqi;top:1.5cqi"><b>Home</b><span class="badge">draft</span><span class="route">/</span></div>
        <div class="ph draft step" style="left:67cqi;top:5.5cqi">
          <div class="top">9:41 <i></i></div>
          <div class="hi">Good morning, Ana</div>
          <div class="changed"><div class="lbl">Across all accounts</div><div class="amt">$4,280.19</div></div>
          <div class="row changed"><span>Ready to send</span><b>$1,120.00</b></div>
          <div class="btns"><span>Send</span><span>Request</span></div>
          <div class="li"><i></i><span><s></s><s></s></span></div>
          <div class="li"><i></i><span><s></s><s></s></span></div>
        </div>
        <div class="fh yours step" style="left:67cqi;top:1.5cqi"><b id="yours-name">Home</b><span class="badge">demo draft</span></div>
        <div class="ph yours step" id="yours" style="left:67cqi;top:5.5cqi"></div>

        <div class="pin auto step" style="left:24.5cqi;top:14.3cqi">M</div>
        <div class="pin mine step" id="mypin" style="left:24.5cqi;top:14.3cqi">Y</div>

        <div class="card thread step" style="left:29.5cqi;top:17cqi;width:33cqi">
          <div class="msg">
            <div class="who"><i style="background:var(--maya)"></i>Maya</div>
            <p>This reads as spendable, but it's every account added up. Can we say that?</p>
          </div>
          <div class="msg reply step">
            <div class="who"><i style="background:var(--dev)"></i>Dev</div>
            <p>Agreed. Sending it to the agent.</p>
            <span class="send">&#9889; Send to agent</span>
          </div>
        </div>

        <div class="card agent step" style="left:3cqi;top:67cqi;width:30cqi">
          <div class="br"><i></i><span id="ag-br">commons/balance-label</span></div>
          <div class="ln a1 step"><span class="ok">&#10003;</span><span id="ag-1">Read the Home screen and thread</span></div>
          <div class="ln a2 step"><span class="ok">&#10003;</span><span id="ag-2">Renamed the balance, split out what's sendable</span></div>
          <div class="ln a3 step"><span class="wait">&#9679; Building a preview</span><span class="ready" id="ag-r">&#10003; Preview ready for the team</span></div>
        </div>

        <div class="stk pop fire step" style="left:88cqi;top:3cqi;--r:14deg">&#128293;</div>
        <div class="stk pop party step" style="left:29cqi;top:61cqi;--r:-12deg">&#127881;</div>

        <div class="cur c-maya">${CURSOR}<span>Maya</span></div>
        <div class="cur c-dev">${CURSOR}<span>Dev</span></div>
      </div>

      <button type="button" class="hit" data-src="ph-home" data-name="Home" style="left:3cqi;top:5.5cqi;width:28cqi;height:58.4cqi" aria-label="Leave a comment on the Home screen"></button>
      <button type="button" class="hit" data-src="ph-send" data-name="Send money" style="left:35cqi;top:17cqi;width:28cqi;height:58.4cqi" aria-label="Leave a comment on the Send money screen"></button>

      <div class="composer" id="composer" role="dialog" aria-labelledby="cm-title" data-state="write" hidden>
        <div class="cm-head"><span class="cm-me" aria-hidden="true">Y</span><span id="cm-title">You, on <b id="cm-where">Home</b></span></div>
        <div class="cm-write">
          <label class="vh" for="cm-text">Your comment</label>
          <textarea id="cm-text" rows="3" maxlength="140" placeholder="What would you change here?"></textarea>
          <div class="cm-chips">
            <button type="button" data-t="Make this easier to read">Easier to read</button>
            <button type="button" data-t="This should stand out more">Stand out more</button>
            <button type="button" data-t="Say what this number means">Say what it means</button>
          </div>
          <div class="cm-acts">
            <button type="button" class="cm-link" id="cm-cancel">Cancel</button>
            <button type="button" class="btn do sm" id="cm-send" disabled>Send to agent</button>
          </div>
        </div>
        <div class="cm-sent">
          <p class="cm-quote" id="cm-quote"></p>
          <p class="cm-status">&#9889; Sent to the agent</p>
        </div>
        <div class="cm-done">
          <p class="cm-big">Your draft is back.</p>
          <p class="cm-note">In Commons, the agent edits your real code on its own branch and hands back a preview link. This one was a demo.</p>
          <div class="cm-acts">
            <button type="button" class="cm-link" id="cm-replay">Replay</button>
            <a class="btn do sm" id="cm-try" href="${APP_URL}">Try it on your app</a>
          </div>
        </div>
      </div>

      <p class="turn" aria-hidden="true">${TURN_HINT}</p>
    </div>
  </div>
</section>

<div class="works">
  <div class="wrap">
    <span class="lead">Works with</span>
    <span class="tag">Next.js</span><span class="tag">Vite</span><span class="tag">Expo</span><span class="tag">React</span><span class="tag">SvelteKit</span><span class="tag">Astro</span><span class="tag">GitHub</span><span class="tag">Vercel</span><span class="tag">Figma</span><span class="tag">Slack</span><span class="tag">Claude Code</span>
  </div>
</div>

<!-- Why: the stale mock beside the live screen. -->
<section class="stale">
  <div class="wrap">
    <div>
      <h2>Mocks go stale the moment code lands.</h2>
      <p class="lede">
        When an agent can ship a change before lunch, the design file is out of date by the
        afternoon. Commons moves the conversation onto the thing that actually runs, so nobody
        reviews a screenshot of last week.
      </p>
    </div>
    <div class="exhibit" aria-hidden="true">
      <div class="mock">
        <div class="file">checkout_v7_final_FINAL.fig</div>
        <s class="w6"></s><s class="w8"></s><s class="blk"></s><s class="w4"></s><s class="w8"></s><s class="blk"></s>
      </div>
      <span class="stk stuck" style="left:44%;top:16px;--r:-12deg">&#128533;</span>
      <div class="note-y">${NOTE_TEXT}</div>
      <div class="livebox">
        <div class="fh"><b>Checkout</b><span class="route">/checkout</span><span class="on"><i></i>live</span></div>
        <div class="ph2">
          <div class="t">Review transfer</div>
          <div class="line"><span>To Jordan</span><span>$120.00</span></div>
          <div class="line"><span>Fee</span><span>$0.00</span></div>
          <hr />
          <div class="tot"><span>Total</span><span>$120.00</span></div>
          <div class="line"><span>Arrives</span><span>In minutes</span></div>
          <div class="pay">Send $120</div>
        </div>
      </div>
      <span class="stk stuck" style="right:-3%;top:44px;--r:12deg;font-size:44px">&#128293;</span>
    </div>
  </div>
</section>

<!-- How: five frames, tinted by status and joined the way Flow joins screens. -->
<section id="how">
  <div class="wrap">
    <div class="flow-head">
      <h2>From &ldquo;hmm&rdquo; to shipped, on one canvas</h2>
      <p class="lede">Five stops, and nobody has to leave the canvas to get from a hunch to a fix.</p>
    </div>

    <div class="frames">
      <div class="fr c1">
        <div class="fh"><b>Connect</b><span class="route">/connect</span></div>
        <span class="stk stuck" style="--r:12deg" aria-hidden="true">&#128161;</span>
        <div class="sheet">
          <div>
            <h3>Put your app on the canvas</h3>
            <p>Connect GitHub and your deployed repos turn into projects on their own. Or point the Mac app at a repo and every route lands as a live screen. No repo handy? Paste a link.</p>
            <ul>
              <li>No deploy host? Previews build in your own GitHub Actions</li>
              <li>In a monorepo, it asks which app you meant</li>
              <li>Screens refresh themselves on every deploy</li>
            </ul>
          </div>
          <div class="vig" aria-hidden="true">
            <div class="row"><span class="chip"><i></i>harbor-web</span><span class="dim">deployed</span><span class="pct">new project</span></div>
            <div class="minis">
              <div><div class="fhm"><i></i>/</div><s class="a"></s><s></s><s class="b"></s><s></s></div>
              <div><div class="fhm"><i></i>/send</div><s></s><s class="b"></s><s class="a"></s><s></s></div>
              <div><div class="fhm"><i></i>/goals</div><s class="a"></s><s class="b"></s><s></s><s></s></div>
            </div>
          </div>
        </div>
      </div>

      <div class="edge" aria-hidden="true"><svg viewBox="0 0 100 100" preserveAspectRatio="none"><path d="M33 0 C33 55, 67 45, 67 100" /></svg><span class="tip" style="left:67%;top:100%"></span></div>

      <div class="fr r c2">
        <div class="fh"><b>Comment</b><span class="route">/comment</span></div>
        <span class="stk stuck" style="--r:-10deg" aria-hidden="true">&#128064;</span>
        <div class="sheet">
          <div>
            <h3>Talk on the real screen</h3>
            <p>Click anywhere on the running app to start a thread pinned to that screen and route. Teammates see your cursor as you go, and anyone with a share link can join with just a name.</p>
            <ul>
              <li>Threads, replies, and mentions</li>
              <li>Stickers for quick reactions, stuck where you mean</li>
              <li>Figma frames sit beside the live screens</li>
            </ul>
          </div>
          <div class="vig thr" aria-hidden="true">
            <div class="m"><div class="who"><i style="background:var(--maya)"></i>Maya</div><p>The fee line disappears on small phones. Can it stay above the fold?</p></div>
            <div class="m"><div class="who"><i style="background:var(--bronze)"></i>Priya <span class="g">guest, via link</span></div><p>Same on my phone. I didn't see a fee at all.</p></div>
          </div>
        </div>
      </div>

      <div class="edge" aria-hidden="true"><svg viewBox="0 0 100 100" preserveAspectRatio="none"><path d="M67 0 C67 55, 33 45, 33 100" /></svg><span class="tip" style="left:33%;top:100%"></span></div>

      <div class="fr c3">
        <div class="fh"><b>Draft</b><span class="route">/draft</span></div>
        <span class="stk stuck" style="--r:10deg" aria-hidden="true">&#9986;&#65039;</span>
        <div class="sheet">
          <div>
            <h3>Hand the thread to an agent</h3>
            <p>Send a thread to your coding agent and it gets the whole picture: the screen, the route, and the conversation. It works on its own branch and comes back with a preview link anyone can open.</p>
            <ul>
              <li>Runs on your Mac, or in your repo's own GitHub Actions</li>
              <li>Never touches a dirty tree, never merges for you</li>
              <li>Uses your own Anthropic or OpenRouter key</li>
            </ul>
          </div>
          <div class="vig" aria-hidden="true">
            <div class="row"><span class="mono">commons/fee-above-fold</span><span class="pct">ready</span></div>
            <div class="row"><span class="ok">&#10003;</span><span>Read the Checkout screen and thread</span></div>
            <div class="row"><span class="ok">&#10003;</span><span>Moved the fee line into the summary</span></div>
            <div class="row"><span class="ok">&#10003;</span><span>Built a preview</span></div>
            <div class="row"><span class="act">Open the draft</span><span class="dim">2 files changed</span></div>
          </div>
        </div>
      </div>

      <div class="edge" aria-hidden="true"><svg viewBox="0 0 100 100" preserveAspectRatio="none"><path d="M33 0 C33 55, 67 45, 67 100" /></svg><span class="tip" style="left:67%;top:100%"></span></div>

      <div class="fr r c4">
        <div class="fh"><b>Test</b><span class="route">/test</span></div>
        <span class="stk stuck" style="--r:-12deg" aria-hidden="true">&#127881;</span>
        <div class="sheet">
          <div>
            <h3>Prove it with real people</h3>
            <p>Write a few tasks and send one link. Testers use your live app in their own browser, with no account and no install, and the results land on the same screens.</p>
            <ul>
              <li>Success rates, times, and where people gave up</li>
              <li>Click heatmaps drawn onto the screens</li>
              <li>A failed task can go straight to an agent as a fix</li>
            </ul>
          </div>
          <div class="vig" aria-hidden="true">
            <div class="row">Send money to a saved contact<span class="pct">92%</span></div>
            <div class="row">Find the fee before paying<span class="pct">88%</span></div>
            <div class="row">Set up a recurring transfer<span class="pct low">41%</span></div>
            <div class="heat">
              <s style="top:18px"></s><s style="top:38px;right:40%"></s><s style="top:58px;right:25%"></s>
              <i style="left:22%;top:12px"></i><i style="left:30%;top:30px"></i><i style="left:64%;top:52px"></i>
              <i style="left:70%;top:18px"></i><i style="left:44%;top:60px"></i><i style="left:58%;top:34px"></i>
            </div>
          </div>
        </div>
      </div>

      <div class="edge" aria-hidden="true"><svg viewBox="0 0 100 100" preserveAspectRatio="none"><path d="M67 0 C67 55, 33 45, 33 100" /></svg><span class="tip" style="left:33%;top:100%"></span></div>

      <div class="fr c5">
        <div class="fh"><b>Explain</b><span class="route">/why</span></div>
        <span class="stk stuck" style="--r:9deg" aria-hidden="true">&#10084;&#65039;</span>
        <div class="sheet">
          <div>
            <h3>Keep the why, with receipts</h3>
            <p>Commons reads your threads, test results, and commit history, then drafts the reasoning behind each screen with a source for every claim. Nothing is published until a person approves it.</p>
            <ul>
              <li>Sources point to commits, docs, threads, and tests</li>
              <li>Anything it guessed is labeled as a guess</li>
              <li>The reasoning travels with every share link</li>
            </ul>
          </div>
          <div class="vig" aria-hidden="true">
            <div class="note">The fee sits in the summary, not below it, because testers missed it on small phones.
              <br /><span class="cite">test, 12 sessions</span><span class="cite">commit 4cf2699</span></div>
            <div class="note">Send opens straight onto the keypad so the amount is the first thing your thumb meets.
              <br /><span class="cite guess">a guess, approve to keep</span></div>
          </div>
        </div>
      </div>
    </div>

    <div class="start">
      <div class="sheet">
        <div>
          <h3>Your first project takes about two minutes.</h3>
          <p>Sign in with Google or an email link. Nothing to install to get started.</p>
        </div>
        <div><a class="btn do big" href="${APP_URL}">Open Commons in your browser</a></div>
      </div>
    </div>
  </div>
</section>

<!-- Who: one frame, three people, switched with the app's own control. -->
<section id="roles">
  <div class="wrap">
    <div class="roles-head">
      <h2>One canvas for everyone with opinions about the product</h2>
      <p class="lede">Designers work in a file, engineers work in the repo, and PMs work in whatever screenshot reached them last. Commons gives all three the same live app.</p>
    </div>
    <div class="seg" role="tablist" aria-label="Who it's for">
      <button role="tab" id="t-design" aria-controls="p-design" aria-selected="true">Designers</button>
      <button role="tab" id="t-eng" aria-controls="p-eng" aria-selected="false" tabindex="-1">Engineers</button>
      <button role="tab" id="t-pm" aria-controls="p-pm" aria-selected="false" tabindex="-1">Product managers</button>
    </div>
    <div class="role" id="p-design" role="tabpanel" aria-labelledby="t-design">
      <div class="sheet">
        <div><h3>Critique the build, not a picture of it</h3><p>Review what users will actually get, at the real breakpoint, with the real data.</p></div>
        <ul>
          <li>Pin a comment to the real screen at the real size</li>
          <li>Figma frames sit on the same canvas as the live app</li>
          <li>Hand a thread to an agent and get a draft with a preview link</li>
          <li>Duplicate a screen to sketch an alternative beside the original</li>
          <li>Heatmaps and task results from real testers land on the screens</li>
        </ul>
      </div>
    </div>
    <div class="role" id="p-eng" role="tabpanel" aria-labelledby="t-eng" hidden>
      <div class="sheet">
        <div><h3>Feedback that arrives with its context</h3><p>Every comment carries the screen, the route, and the conversation that led to it.</p></div>
        <ul>
          <li>Point it at the repo: routes are found and each screen runs from your dev server</li>
          <li>Agents run on your Mac or in your repo's own GitHub Actions</li>
          <li>Drafts land on a branch, never on a dirty tree, never merged for you</li>
          <li>Previews build in your own CI when you have no deploy host</li>
          <li>Nothing arrives as "the thing looked wrong" again</li>
        </ul>
      </div>
    </div>
    <div class="role" id="p-pm" role="tabpanel" aria-labelledby="t-pm" hidden>
      <div class="sheet">
        <div><h3>See where things stand without asking</h3><p>The whole product in one place, current as of the last deploy.</p></div>
        <ul>
          <li>No install and no terminal: the full canvas runs in the browser</li>
          <li>Share a link with executives and customers who have no account</li>
          <li>Flow view draws the paths real testers actually took</li>
          <li>Success rates, times, and where people gave up</li>
          <li>Preview links keep themselves current from your deploys</li>
        </ul>
      </div>
    </div>
  </div>
</section>

<section id="faq" class="faq">
  <div class="wrap">
    <h2 style="max-width:14ch">Good questions</h2>
    <div class="sheet" style="margin-top:48px">
      <details open>
        <summary>Do my teammates need the code to use this?</summary>
        <p>No. Whoever has the repo can run it locally, and everyone else sees the same screens through a deployed or Commons-built preview link. Designers, PMs, and stakeholders never touch a terminal.</p>
      </details>
      <details>
        <summary>Will it touch my repository?</summary>
        <p>Only when you ask. Commons never works on a dirty tree, never merges for you, and never stores git credentials. Agent drafts live on their own branch, and you decide what happens next.</p>
      </details>
      <details>
        <summary>Who can see my projects?</summary>
        <p>Your workspace sees your projects. Anyone else who signs in gets their own workspace and sees nothing of yours until invited. A share link opens one project for viewing and commenting, with no account, and you can revoke it at any time.</p>
      </details>
      <details>
        <summary>Does it replace Figma?</summary>
        <p>No. Figma is where you explore what doesn't exist yet. Commons is where the team works on what already runs. Most teams use both, and the handoff between them gets shorter.</p>
      </details>
      <details>
        <summary>Is it Mac only?</summary>
        <p>The desktop app is macOS today, and it's what you need to run dev servers and agents on your own machine. Everything else, including the full canvas, works in any modern browser.</p>
      </details>
      <details>
        <summary>What does connecting GitHub give me?</summary>
        <p>Your deployed repos turn into projects on their own, and deploy events keep their preview links current. Agents and preview builds get a place to run when nobody's laptop is awake. Commons reads only the repos you picked and never recreates a project someone archived or deleted.</p>
      </details>
      <details>
        <summary>What does it cost?</summary>
        <p>Nothing while Commons is in preview. Agent runs use your own Anthropic or OpenRouter key, so model usage is never billed through us.</p>
      </details>
    </div>
  </div>
</section>

<section class="close">
  <span class="stk stuck" style="left:8%;top:18%;--r:-14deg" aria-hidden="true">&#127881;</span>
  <span class="stk stuck" style="left:84%;top:14%;--r:12deg" aria-hidden="true">&#128293;</span>
  <span class="stk stuck" style="left:14%;top:72%;--r:10deg" aria-hidden="true">&#128161;</span>
  <span class="stk stuck" style="left:80%;top:70%;--r:-9deg" aria-hidden="true">&#10084;&#65039;</span>
  <div class="wrap">
    <h2>Put your product on the canvas.</h2>
    <p class="lede">Add your first project in a couple of minutes, then invite the people with opinions about it.</p>
    <div class="actions">
      <span class="you">
        <a class="btn do big" href="${APP_URL}">Open Commons in your browser</a>
        <span class="cur" aria-hidden="true">${CURSOR}<span>You</span></span>
      </span>
      <a class="btn alt big" href="${DOWNLOAD_URL}">Download for Mac</a>
    </div>
  </div>
</section>

</main>

<footer>
  <div class="wrap">
    <a class="brand" href="/">${MARK(24)}Commons</a>
    <nav aria-label="Footer">
      <a href="${APP_URL}">Open Commons</a>
      <a href="${DOWNLOAD_URL}">Download for Mac</a>
      <a href="#how">How it works</a>
      <a href="#roles">Who it's for</a>
      <a href="#faq">Questions</a>
    </nav>
    <p class="v">One shared canvas showing the app that actually runs. ${macLabel}.</p>
  </div>
</footer>

<div class="dock" id="dock" role="toolbar" aria-label="Stickers: pick one, then click anywhere on the page">
  <span class="dock-hint" id="dock-hint" aria-hidden="true">${DOCK_HINT}</span>
  ${DOCK}
  <span class="dock-sep" aria-hidden="true"></span>
  <button type="button" class="dock-mute" id="dock-mute" aria-pressed="true" aria-label="Sticker sounds" title="Sticker sounds">
    <svg class="on" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 7.5h3l4-3.5v12l-4-3.5h-3z"/><path d="M13.5 7a4 4 0 0 1 0 6"/><path d="M15.8 4.8a7 7 0 0 1 0 10.4"/></svg>
    <svg class="off" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 7.5h3l4-3.5v12l-4-3.5h-3z"/><path d="M13.5 7.5l4 5M17.5 7.5l-4 5"/></svg>
  </button>
  <button type="button" class="dock-done" id="dock-done" hidden>Done</button>
</div>
<div class="layer" id="layer"></div>
<div class="ghost stk" id="ghost" aria-hidden="true"></div>

<script>
(function () {
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var sr = document.getElementById("sr");
  function say(msg) { sr.textContent = ""; setTimeout(function () { sr.textContent = msg; }, 30); }

  // Cookie-less counts: one event name per beacon, nothing else sent.
  function count(e) { try { if (navigator.sendBeacon) navigator.sendBeacon("/api/lp", e); } catch (x) { /* never mind */ } }
  count("view");
  document.addEventListener("click", function (ev) {
    var a = ev.target && ev.target.closest ? ev.target.closest("a[href]") : null;
    if (!a) return;
    var href = a.getAttribute("href");
    if (href === "${APP_URL}") count("open_app");
    else if (href === "${DOWNLOAD_URL}") count("download");
  });

  // "shipped today", in the visitor's own calendar.
  var shippedEl = document.getElementById("shipped");
  if (shippedEl) {
    var shipTime = new Date(Number(shippedEl.getAttribute("data-at")));
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var day = new Date(shipTime.getTime()); day.setHours(0, 0, 0, 0);
    var ago = Math.round((today - day) / 86400000);
    if (ago === 0) shippedEl.textContent = "today";
    else if (ago === 1) shippedEl.textContent = "yesterday";
    else if (ago > 1 && ago < 7) shippedEl.textContent = ago + " days ago";
  }

  // Top bar hairline once you leave the top.
  var bar = document.getElementById("bar");
  var onScroll = function () { bar.classList.toggle("stuck", window.scrollY > 8); };
  addEventListener("scroll", onScroll, { passive: true }); onScroll();

  // ── Sound: the app's sticker voices, synthesized, nothing downloaded ──
  var audio = null, lastVoice = 0;
  var muted = false;
  try { muted = localStorage.getItem("commons.landing.sound") === "off"; } catch (x) { /* private mode */ }
  function actx() {
    if (muted) return null;
    try {
      if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === "suspended") audio.resume();
      return audio;
    } catch (x) { return null; }
  }
  function note(a, out, freq, at, dur, peak, dark, pan) {
    var osc = a.createOscillator(); osc.type = "sine"; osc.frequency.value = freq;
    var part = a.createOscillator(); part.type = "sine"; part.frequency.value = freq * 2;
    var pg = a.createGain(); pg.gain.value = 0.18;
    var g = a.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + 0.012);
    g.gain.exponentialRampToValueAtTime(0.001, at + dur);
    var head = g;
    if (dark) { var lp = a.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 1600; g.connect(lp); head = lp; }
    osc.connect(g); part.connect(pg); pg.connect(g);
    if (pan && a.createStereoPanner) { var p = a.createStereoPanner(); p.pan.value = pan; head.connect(p); p.connect(out); }
    else head.connect(out);
    osc.start(at); osc.stop(at + dur + 0.05); part.start(at); part.stop(at + dur + 0.05);
  }
  function noise(a, out, at, dur, peak, hz) {
    var buf = a.createBuffer(1, Math.max(1, Math.floor(a.sampleRate * dur)), a.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    var src = a.createBufferSource(); src.buffer = buf;
    var bp = a.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = hz; bp.Q.value = 1.4;
    var g = a.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + 0.008);
    g.gain.exponentialRampToValueAtTime(0.001, at + dur);
    src.connect(bp); bp.connect(g); g.connect(out); src.start(at);
  }
  var VOICES = {
    heart: function (a, o, t) { note(a, o, 150, t, 0.09, 0.6, true); note(a, o, 105, t + 0.14, 0.14, 0.55, true); },
    fire: function (a, o, t) {
      var tick = t;
      for (var i = 0; i < 5; i++) { noise(a, o, tick, 0.03, 0.35, 1800 + Math.random() * 2600); tick += 0.03 + Math.random() * 0.05; }
      note(a, o, 90, t, 0.28, 0.25, true);
    },
    hmm: function (a, o, t) { note(a, o, 220, t, 0.1, 0.4, true); note(a, o, 277, t + 0.1, 0.2, 0.35, true); note(a, o, 279, t + 0.1, 0.2, 0.2, true); },
    unsure: function (a, o, t) {
      note(a, o, 330, t, 0.12, 0.35); note(a, o, 334, t, 0.12, 0.25);
      note(a, o, 311, t + 0.11, 0.18, 0.35, true); note(a, o, 314, t + 0.11, 0.18, 0.22, true);
    },
    cut: function (a, o, t) { noise(a, o, t, 0.035, 0.5, 3400); noise(a, o, t + 0.11, 0.04, 0.5, 2800); },
    idea: function (a, o, t) { note(a, o, 160, t, 0.22, 0.25, true); note(a, o, 1180, t + 0.12, 0.32, 0.4); },
    party: function (a, o, t) {
      note(a, o, 523, t, 0.08, 0.4); note(a, o, 659, t + 0.06, 0.08, 0.4); note(a, o, 784, t + 0.12, 0.2, 0.45);
      noise(a, o, t + 0.1, 0.03, 0.3, 2400); noise(a, o, t + 0.18, 0.03, 0.28, 3000); noise(a, o, t + 0.26, 0.03, 0.25, 2000);
    },
    look: function (a, o, t) { note(a, o, 740, t, 0.05, 0.42, false, -0.8); note(a, o, 740, t + 0.11, 0.05, 0.42, false, 0.8); },
    peel: function (a, o, t) { note(a, o, 500, t, 0.06, 0.45, true); note(a, o, 290, t + 0.07, 0.12, 0.4, true); }
  };
  function voice(key) {
    var nowMs = Date.now();
    if (nowMs - lastVoice < 140) return; // a flurry of slaps stays a patter, not a drumroll
    lastVoice = nowMs;
    var a = actx(); if (!a) return;
    try {
      var out = a.createGain(); out.gain.value = 0.15; out.connect(a.destination);
      setTimeout(function () { out.disconnect(); }, 1500);
      (VOICES[key] || VOICES.idea)(a, out, a.currentTime + 0.02);
    } catch (x) { /* silence is an acceptable outcome */ }
  }
  var muteBtn = document.getElementById("dock-mute");
  muteBtn.setAttribute("aria-pressed", muted ? "false" : "true");
  muteBtn.addEventListener("click", function (ev) {
    ev.stopPropagation();
    muted = !muted;
    muteBtn.setAttribute("aria-pressed", muted ? "false" : "true");
    try { localStorage.setItem("commons.landing.sound", muted ? "off" : "on"); } catch (x) { /* fine */ }
    if (!muted) voice("idea");
    say(muted ? "Sticker sounds off" : "Sticker sounds on");
  });

  // Shared pointer position: the dot glow and the sticker ghost both follow it.
  var glow = document.getElementById("glow"), ghost = document.getElementById("ghost");
  var sticker = null, stickerVoice = null, raf = 0, px = -200, py = -200;
  function moveGhost() { ghost.style.transform = "translate(" + px + "px," + py + "px) rotate(-8deg)"; }
  addEventListener("pointermove", function (e) {
    if (e.pointerType !== "mouse") return;
    px = e.clientX; py = e.clientY;
    if (!raf) raf = requestAnimationFrame(function () {
      glow.style.setProperty("--mx", px + "px"); glow.style.setProperty("--my", py + "px");
      glow.classList.add("on");
      if (sticker) moveGhost();
      raf = 0;
    });
  }, { passive: true });
  document.addEventListener("mouseleave", function () { glow.classList.remove("on"); });

  // ── The sticker toy: sticker mode from the app ──
  // Pick one, click anywhere, it slaps down; click a placed one to peel it.
  // Done (or Esc) puts the sticker away. From the keyboard, a sticker lands
  // in the middle of the screen, since there is no pointer to aim with.
  var dock = document.getElementById("dock"), layer = document.getElementById("layer");
  var hint = document.getElementById("dock-hint"), doneBtn = document.getElementById("dock-done");
  var placed = 0, countedSticker = false;
  var stickerBtns = [].slice.call(dock.querySelectorAll(".stk-btn"));
  function choose(btn) {
    sticker = btn ? btn.getAttribute("data-e") : null;
    stickerVoice = btn ? btn.getAttribute("data-v") : null;
    document.body.classList.toggle("sticking", !!btn);
    dock.classList.toggle("sticking", !!btn);
    doneBtn.hidden = !btn;
    ghost.textContent = sticker || "";
    moveGhost();
    stickerBtns.forEach(function (b) { b.setAttribute("aria-pressed", b === btn ? "true" : "false"); });
  }
  function placeAt(emoji, key, name, x, y) {
    if (placed >= 60 && layer.firstChild) { layer.firstChild.remove(); placed--; }
    var s = document.createElement("button");
    s.className = "placed stk"; s.type = "button"; s.textContent = emoji;
    s.setAttribute("aria-label", "Peel off the " + name + " sticker");
    s.style.left = x + "px"; s.style.top = y + "px";
    s.style.setProperty("--r", (Math.random() * 34 - 17).toFixed(1) + "deg");
    s.addEventListener("click", function (e2) {
      if (sticker) return;
      e2.stopPropagation(); s.classList.add("peel"); voice("peel");
      setTimeout(function () { s.remove(); placed--; }, reduce ? 0 : 260);
    });
    layer.appendChild(s); placed++;
    voice(key);
    hint.classList.add("gone");
    if (!countedSticker) { countedSticker = true; count("sticker"); }
  }
  stickerBtns.forEach(function (b) {
    b.setAttribute("aria-pressed", "false");
    b.addEventListener("click", function (ev) {
      ev.stopPropagation();
      if (ev.detail === 0) {
        // Keyboard: no pointer to aim with, so it lands near the middle.
        placeAt(b.getAttribute("data-e"), b.getAttribute("data-v"), b.getAttribute("aria-label"),
          window.scrollX + innerWidth * (0.3 + Math.random() * 0.4), window.scrollY + innerHeight * (0.25 + Math.random() * 0.35));
        say("Sticker placed: " + b.getAttribute("aria-label"));
        return;
      }
      choose(b.getAttribute("aria-pressed") === "true" ? null : b);
    });
  });
  doneBtn.addEventListener("click", function (ev) { ev.stopPropagation(); choose(null); });
  document.addEventListener("click", function (ev) {
    if (!sticker || dock.contains(ev.target) || composer.contains(ev.target)) return;
    ev.preventDefault(); ev.stopPropagation();
    var name = "";
    stickerBtns.forEach(function (b) { if (b.getAttribute("aria-pressed") === "true") name = b.getAttribute("aria-label"); });
    placeAt(sticker, stickerVoice, name, ev.pageX, ev.pageY);
  }, true);

  // ── Role switcher: the app's segmented control, with arrow keys ──
  var tabs = [].slice.call(document.querySelectorAll('.seg [role="tab"]'));
  function pick(tab, focus) {
    tabs.forEach(function (t) {
      var on = t === tab;
      t.setAttribute("aria-selected", on ? "true" : "false");
      t.tabIndex = on ? 0 : -1;
      document.getElementById(t.getAttribute("aria-controls")).hidden = !on;
    });
    if (focus) tab.focus();
  }
  tabs.forEach(function (t, i) {
    t.addEventListener("click", function () { pick(t); });
    t.addEventListener("keydown", function (e) {
      if (e.key === "ArrowRight") { e.preventDefault(); pick(tabs[(i + 1) % tabs.length], true); }
      if (e.key === "ArrowLeft") { e.preventDefault(); pick(tabs[(i + tabs.length - 1) % tabs.length], true); }
    });
  });

  // ── The hero: the loop plays on its own, then it's your turn ──
  var scene = document.getElementById("scene");
  var maya = scene.querySelector(".c-maya"), dev = scene.querySelector(".c-dev");
  function at(el, x, y) { el.style.transform = "translate(" + x + "cqi," + y + "cqi)"; }
  function set(s) { scene.setAttribute("data-s", s); }
  function add(s) { set((scene.getAttribute("data-s") + " " + s).trim()); }
  function drop(s) {
    var gone = s.split(" ");
    set(scene.getAttribute("data-s").split(" ").filter(function (x) { return gone.indexOf(x) < 0; }).join(" "));
  }
  // Jump to a state with transitions off, then turn them back on.
  function snap(s) { set(("reset " + s).trim()); void scene.offsetWidth; set(s); }
  at(maya, 88, 74); at(dev, 56, 84); // opening marks, set before first paint

  var autoplay = !reduce;
  function showFinal() { snap("pin agent a1 a2 a3 ready draft diff fire party"); at(maya, 50, 30); at(dev, 88, 62); }
  var script = [
    [0, function () { set("reset"); at(maya, 88, 74); at(dev, 56, 84); }],
    [80, function () { set(""); }],
    [700, function () { at(maya, 25.2, 17.9); }],
    [1800, function () { add("pin"); }],
    [2300, function () { add("thread"); }],
    [3000, function () { at(dev, 46, 50); }],
    [3700, function () { add("reply"); }],
    [4700, function () { add("send"); }],
    [5500, function () { drop("thread reply send"); add("agent a1"); at(maya, 30, 60); }],
    [6300, function () { add("a2"); }],
    [7100, function () { add("a3"); }],
    [8000, function () { add("draft"); at(dev, 90, 34); }],
    [8900, function () { add("ready diff"); at(maya, 84, 16); }],
    [9300, function () { add("fire"); }],
    [9700, function () { add("party"); }],
    [12600, function () { add("out"); }]
  ];
  var LOOP = 13400, timers = [], running = false, mine = false;
  function play() {
    if (running) return; running = true;
    (function cycle() {
      script.forEach(function (s) { timers.push(setTimeout(s[1], s[0])); });
      timers.push(setTimeout(function () { timers = []; if (running) cycle(); }, LOOP));
    })();
  }
  function stop() { running = false; timers.forEach(clearTimeout); timers = []; }
  // Play only while the scene is on screen in a visible tab, and never while
  // the visitor has the canvas. Both signals can flip in either order (a
  // page opened in a background tab reports hidden first), so each re-checks.
  var inView = !("IntersectionObserver" in window);
  function sync() {
    if (mine) return;
    if (!autoplay) { showFinal(); return; }
    if (inView && !document.hidden) play(); else stop();
  }
  if (!inView) {
    new IntersectionObserver(function (es) {
      es.forEach(function (e) { inView = e.isIntersecting; }); sync();
    }, { threshold: 0.25 }).observe(scene);
  }
  document.addEventListener("visibilitychange", sync);

  // Your turn: pin a screen, write a comment, send it, get a demo draft.
  var composer = document.getElementById("composer"), cmText = document.getElementById("cm-text");
  var cmSend = document.getElementById("cm-send"), mypin = document.getElementById("mypin");
  var yours = document.getElementById("yours"), yoursName = document.getElementById("yours-name");
  var agBr = document.getElementById("ag-br"), ag1 = document.getElementById("ag-1"), ag2 = document.getElementById("ag-2"), agR = document.getElementById("ag-r");
  var AGENT = { br: agBr.textContent, a1: ag1.textContent, a2: ag2.textContent, r: agR.textContent };
  var turnTimers = [], pinAt = null, src = null, where = "", anchor = null, openedOnce = false, sentOnce = false;
  function clearTurn() { turnTimers.forEach(clearTimeout); turnTimers = []; }
  function state(s) { composer.setAttribute("data-state", s); }
  // Writing: the box sits beside your pin. Once sent, it steps aside so the
  // draft (the payoff) stays in view: over the original screen on a wide
  // stage, or below the stage, in the page's flow, on a narrow one.
  function placeComposer() {
    if (!anchor) return;
    var writing = composer.getAttribute("data-state") === "write";
    var sw = scene.clientWidth, narrow = sw < 520;
    composer.classList.toggle("below", !writing && narrow);
    composer.classList.toggle("aside", !writing && !narrow);
    if (!writing && narrow) { composer.style.left = ""; composer.style.top = ""; return; }
    var stageH = scene.querySelector(".stage").offsetHeight, cw = composer.offsetWidth, ch = composer.offsetHeight;
    var l, t;
    if (writing) {
      l = anchor.x + 22; t = anchor.y - 14;
      if (l + cw > sw - 8) l = anchor.x - cw - 22;
    } else {
      l = 8; t = stageH * 0.3;
    }
    l = Math.max(8, Math.min(l, sw - cw - 8));
    t = Math.max(8, Math.min(t, stageH - ch - 8));
    composer.style.left = l + "px"; composer.style.top = t + "px";
  }
  function openTurn(hit, ev) {
    if (mine && composer.getAttribute("data-state") !== "write") return;
    stop(); clearTurn(); mine = true;
    var r = scene.getBoundingClientRect(), u = r.width / 100;
    var left = parseFloat(hit.style.left), top = parseFloat(hit.style.top);
    var w = parseFloat(hit.style.width), h = parseFloat(hit.style.height);
    var x = left + w * 0.5, y = top + h * 0.32;
    if (ev && ev.detail > 0) { x = (ev.clientX - r.left) / u; y = (ev.clientY - r.top) / u; }
    x = Math.max(left + 3, Math.min(x, left + w - 3));
    y = Math.max(top + 5, Math.min(y, top + h - 3));
    pinAt = { x: x, y: y, left: left, top: top };
    src = document.getElementById(hit.getAttribute("data-src"));
    where = hit.getAttribute("data-name");
    at(maya, 88, 74); at(dev, 56, 84);
    snap("mine mypin");
    mypin.style.left = (x - 0.6) + "cqi"; mypin.style.top = (y - 4.4) + "cqi";
    document.getElementById("cm-where").textContent = where;
    state("write"); composer.hidden = false;
    anchor = { x: x * u, y: y * u };
    placeComposer();
    cmText.focus({ preventScroll: true });
    if (!openedOnce) { openedOnce = true; count("turn_open"); }
  }
  function endTurn() {
    clearTurn(); composer.hidden = true; mine = false; anchor = null;
    yours.innerHTML = ""; cmText.value = ""; cmSend.disabled = true;
    agBr.textContent = AGENT.br; ag1.textContent = AGENT.a1; ag2.textContent = AGENT.a2; agR.textContent = AGENT.r;
    snap("");
    sync();
  }
  function sendTurn() {
    var text = cmText.value.trim();
    if (!text) return;
    document.getElementById("cm-quote").textContent = text;
    state("sent"); placeComposer();
    add("locked");
    if (!sentOnce) { sentOnce = true; count("turn_send"); }
    agBr.textContent = "commons/your-idea";
    ag1.textContent = "Read your comment on " + where;
    ag2.textContent = "Drafted a change where you pinned";
    agR.textContent = "✓ Draft ready for you";
    var steps = [
      [450, function () { add("agent a1"); at(dev, 30, 60); }],
      [1150, function () { add("a2"); }],
      [1850, function () { add("a3"); }],
      [2650, function () {
        yours.innerHTML = src.innerHTML;
        var hl = document.createElement("i"); hl.className = "hl";
        hl.style.left = (pinAt.x - pinAt.left) + "cqi"; hl.style.top = (pinAt.y - pinAt.top) + "cqi";
        yours.appendChild(hl);
        yoursName.textContent = where;
        add("yourdraft"); at(maya, 84, 16);
      }],
      [3350, function () { add("ready yhl"); }],
      [3650, function () { add("fire"); }],
      [3950, function () { add("party"); voice("party"); }],
      [4500, function () {
        state("done"); placeComposer();
        document.getElementById("cm-try").focus({ preventScroll: true });
        say("Your demo draft is back. In Commons, the agent edits your real code on its own branch.");
      }]
    ];
    steps.forEach(function (s) { turnTimers.push(setTimeout(s[1], reduce ? Math.min(s[0], 300) : s[0])); });
  }
  [].slice.call(scene.querySelectorAll(".hit")).forEach(function (hit) {
    hit.addEventListener("click", function (ev) { openTurn(hit, ev); });
  });
  cmText.addEventListener("input", function () { cmSend.disabled = !cmText.value.trim(); });
  cmText.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendTurn(); }
  });
  [].slice.call(composer.querySelectorAll(".cm-chips button")).forEach(function (b) {
    b.addEventListener("click", function () { cmText.value = b.getAttribute("data-t"); cmSend.disabled = false; cmText.focus(); });
  });
  cmSend.addEventListener("click", sendTurn);
  document.getElementById("cm-cancel").addEventListener("click", endTurn);
  document.getElementById("cm-replay").addEventListener("click", endTurn);
  addEventListener("resize", placeComposer);

  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    if (sticker) { choose(null); return; }
    if (mine && !composer.hidden) endTurn();
  });

  sync();
})();
</script>
</body>
</html>`;
}
