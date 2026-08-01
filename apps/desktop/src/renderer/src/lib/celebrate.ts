/**
 * The send-off: an archived project card gets pulled into a small void.
 *
 * Archiving is the quiet death of the grid, a card just stops being there, so
 * this gives it a moment instead: a point of nothing opens behind the card,
 * the card is drawn in, a few flecks of its own brand colors follow, and it
 * closes with a soft thup. Vacuum rather than explosion, because archiving is
 * a putting-away, not a destruction; the project still exists, share links
 * stay alive, and the animation should say "tidied into somewhere" rather
 * than "blown to bits".
 *
 * Design constraints that shaped it:
 * - The card is CLONED into a fixed overlay and the original hidden. Convex
 *   reactivity unmounts the real card whenever the mutation lands, and the
 *   clone must not care. The original's visibility is restored afterwards, so
 *   a failed archive never leaves an invisible card.
 * - No assets. The whoosh is synthesized in Web Audio: nothing in the bundle,
 *   no license, and it varies slightly every time the way samples never do.
 * - prefers-reduced-motion skips the theatrics. A vestibular trigger is a
 *   high price for a joke.
 * - Everything is fire-and-forget and wrapped against failure: a broken
 *   AudioContext must never break archiving.
 */

const DURATION_MS = 560;
const FLECKS = 14;

function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function cssColor(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

/**
 * One AudioContext for the app's lifetime, created on first use.
 *
 * Not a style choice: macOS takes 100-300ms to spin up audio hardware for a
 * fresh context, and sounds scheduled at "now" on a brand-new one are
 * swallowed before the speakers are live. A per-call context made the whole
 * whoosh inaudible on first (often only) use, which is why the vacuum
 * appeared to have no sound at all. Persistent context, and everything is
 * scheduled a breath after currentTime.
 */
let audio: AudioContext | null = null;
function audioCtx(): AudioContext | null {
  try {
    if (!audio) audio = new AudioContext();
    if (audio.state === "suspended") void audio.resume();
    return audio;
  } catch {
    return null;
  }
}

/**
 * The cartoon vacuum, in four parts: the slurp (a rising glide with a little
 * vibrato, the recognizable "sucked up"), air rushing in behind it, the void
 * closing with a low thup, and one high blip as a wink. ~0.5s, sized to the
 * animation.
 */
function playVacuum(): void {
  try {
    const ctx = audioCtx();
    if (!ctx) return;
    const master = ctx.createGain();
    master.gain.value = 0.32;
    master.connect(ctx.destination);
    const t0 = ctx.currentTime + 0.04;

    // The slurp: triangle gliding up an octave and a half, with vibrato.
    const slurp = ctx.createOscillator();
    slurp.type = "triangle";
    slurp.frequency.setValueAtTime(210 + Math.random() * 40, t0);
    slurp.frequency.exponentialRampToValueAtTime(1150, t0 + 0.3);
    const vibrato = ctx.createOscillator();
    vibrato.frequency.value = 26;
    const vibratoDepth = ctx.createGain();
    vibratoDepth.gain.value = 22;
    vibrato.connect(vibratoDepth).connect(slurp.frequency);
    const slurpTone = ctx.createBiquadFilter();
    slurpTone.type = "lowpass";
    slurpTone.frequency.value = 2400;
    const slurpGain = ctx.createGain();
    slurpGain.gain.setValueAtTime(0.0001, t0);
    slurpGain.gain.exponentialRampToValueAtTime(0.42, t0 + 0.16);
    slurpGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.34);
    slurp.connect(slurpTone).connect(slurpGain).connect(master);
    slurp.start(t0);
    slurp.stop(t0 + 0.36);
    vibrato.start(t0);
    vibrato.stop(t0 + 0.36);

    // Air rushing in with it.
    const noiseBuffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.34), ctx.sampleRate);
    const channel = noiseBuffer.getChannelData(0);
    for (let i = 0; i < channel.length; i += 1) channel[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;
    const airFilter = ctx.createBiquadFilter();
    airFilter.type = "bandpass";
    airFilter.Q.value = 1.2;
    airFilter.frequency.setValueAtTime(500, t0);
    airFilter.frequency.exponentialRampToValueAtTime(2600, t0 + 0.3);
    const airGain = ctx.createGain();
    airGain.gain.setValueAtTime(0.0001, t0);
    airGain.gain.exponentialRampToValueAtTime(0.5, t0 + 0.22);
    airGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.35);
    noise.connect(airFilter).connect(airGain).connect(master);
    noise.start(t0);

    // The void closes: a deep thup with a soft knock inside it.
    const thup = ctx.createOscillator();
    thup.type = "sine";
    thup.frequency.setValueAtTime(135, t0 + 0.36);
    thup.frequency.exponentialRampToValueAtTime(52, t0 + 0.47);
    const thupGain = ctx.createGain();
    thupGain.gain.setValueAtTime(0.0001, t0 + 0.36);
    thupGain.gain.exponentialRampToValueAtTime(0.7, t0 + 0.375);
    thupGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.5);
    thup.connect(thupGain).connect(master);
    thup.start(t0 + 0.36);
    thup.stop(t0 + 0.52);

    // A wink on the way out.
    const blip = ctx.createOscillator();
    blip.type = "sine";
    blip.frequency.value = 1860 + Math.random() * 120;
    const blipGain = ctx.createGain();
    blipGain.gain.setValueAtTime(0.0001, t0 + 0.46);
    blipGain.gain.exponentialRampToValueAtTime(0.09, t0 + 0.47);
    blipGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.54);
    blip.connect(blipGain).connect(master);
    blip.start(t0 + 0.46);
    blip.stop(t0 + 0.56);

    // Release the master chain once the tail is done; the context stays.
    window.setTimeout(() => master.disconnect(), 900);
  } catch {
    // No audio is an acceptable outcome; a thrown error here is not.
  }
}

/**
 * Pull the element into a void at its center. Safe to call as the element is
 * unmounting. `colors` should be the project's brand colors; theme tokens
 * fill in when a project has none.
 */
export function vacuumFrom(el: HTMLElement, colors: string[] = []): void {
  playVacuum();
  if (reducedMotion()) return;

  const rect = el.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const palette = [
    ...colors.filter((c) => typeof c === "string" && c.length > 0),
    cssColor("--accent", "#7c9c7c"),
    cssColor("--text-tertiary", "#8f8d80"),
  ];

  const overlay = document.createElement("div");
  overlay.className = "celebrate-overlay";
  document.body.appendChild(overlay);

  // The void: opens fast, waits for the card, snaps shut.
  const voidDot = document.createElement("div");
  voidDot.className = "vacuum-void";
  voidDot.style.left = `${cx}px`;
  voidDot.style.top = `${cy}px`;
  overlay.appendChild(voidDot);
  voidDot.animate(
    [
      { transform: "translate(-50%, -50%) scale(0)", opacity: 0 },
      { transform: "translate(-50%, -50%) scale(1)", opacity: 1, offset: 0.25 },
      { transform: "translate(-50%, -50%) scale(1)", opacity: 1, offset: 0.82 },
      { transform: "translate(-50%, -50%) scale(0)", opacity: 0 },
    ],
    { duration: DURATION_MS + 140, easing: "cubic-bezier(0.4, 0, 0.2, 1)" }
  );

  // The card itself: a clone in the overlay, so reactivity can unmount the
  // original mid-animation without the visual caring.
  const ghost = el.cloneNode(true) as HTMLElement;
  ghost.className = `${el.className} vacuum-ghost`;
  ghost.style.left = `${rect.left}px`;
  ghost.style.top = `${rect.top}px`;
  ghost.style.width = `${rect.width}px`;
  ghost.style.height = `${rect.height}px`;
  overlay.appendChild(ghost);
  el.style.visibility = "hidden";

  const spin = (Math.random() < 0.5 ? -1 : 1) * (14 + Math.random() * 14);
  ghost.animate(
    [
      { transform: "scale(1) rotate(0deg)", opacity: 1, easing: "cubic-bezier(0.5, 0, 0.9, 0.4)" },
      { transform: `scale(0.82) rotate(${spin * 0.3}deg)`, opacity: 1, offset: 0.4 },
      { transform: `scale(0.02) rotate(${spin}deg)`, opacity: 0.6 },
    ],
    { duration: DURATION_MS, easing: "cubic-bezier(0.6, 0, 0.95, 0.5)", fill: "forwards" }
  );

  // Flecks of the project's colors, caught in the draft and pulled in after.
  for (let i = 0; i < FLECKS; i += 1) {
    const fleck = document.createElement("div");
    fleck.className = "celebrate-particle";
    const size = 3 + Math.random() * 5;
    fleck.style.width = `${size}px`;
    fleck.style.height = `${size}px`;
    fleck.style.background = palette[i % palette.length];
    fleck.style.borderRadius = "50%";
    fleck.style.left = `${cx}px`;
    fleck.style.top = `${cy}px`;
    overlay.appendChild(fleck);

    const angle = Math.random() * Math.PI * 2;
    const distance = 70 + Math.random() * 130;
    const sx = Math.cos(angle) * distance;
    const sy = Math.sin(angle) * distance;
    const delay = Math.random() * 180;
    fleck.animate(
      [
        { transform: `translate(${sx}px, ${sy}px) scale(1)`, opacity: 0 },
        { transform: `translate(${sx * 0.7}px, ${sy * 0.7}px) scale(0.9)`, opacity: 0.9, offset: 0.3 },
        { transform: "translate(0, 0) scale(0.2)", opacity: 0 },
      ],
      { duration: DURATION_MS - 60, delay, easing: "cubic-bezier(0.55, 0, 1, 0.45)", fill: "backwards" }
    );
  }

  window.setTimeout(() => {
    overlay.remove();
    // If the archive failed, the card is still mounted and comes back; if it
    // succeeded, the node is gone and this is a no-op.
    el.style.visibility = "";
  }, DURATION_MS + 180);
}
