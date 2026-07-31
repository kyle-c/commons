/**
 * The send-off: a project card bursts into its own brand colors on archive.
 *
 * Archiving is the quiet death of the grid, a card just stops being there, so
 * this gives it a moment instead. The particles take the project's colors,
 * because it should feel like THIS project going out, not a generic effect.
 *
 * Design constraints that shaped it:
 * - The overlay is independent of the card's DOM life. Convex reactivity
 *   unmounts the card as soon as the mutation lands, and the burst must not
 *   care. Rect in, pixels out.
 * - No assets. The sound is synthesized in Web Audio, so nothing is added to
 *   the bundle and there is no license to track. It also means the pop varies
 *   slightly every time, which samples never do.
 * - prefers-reduced-motion skips the whole thing. A vestibular trigger is a
 *   high price for a joke.
 * - Everything is fire-and-forget and wrapped against failure: a broken
 *   AudioContext must never break archiving.
 */

const PARTICLES = 26;
const DURATION_MS = 850;

function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function cssColor(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

/** A short pop with a little glitter after it. Roughly 0.4s, deliberately quiet. */
function playPop(): void {
  try {
    const ctx = new AudioContext();
    const master = ctx.createGain();
    master.gain.value = 0.14;
    master.connect(ctx.destination);
    const now = ctx.currentTime;

    // The body of the pop: a sine dropping fast, like a cork.
    const body = ctx.createOscillator();
    body.type = "sine";
    body.frequency.setValueAtTime(320 + Math.random() * 60, now);
    body.frequency.exponentialRampToValueAtTime(70, now + 0.13);
    const bodyGain = ctx.createGain();
    bodyGain.gain.setValueAtTime(1, now);
    bodyGain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
    body.connect(bodyGain).connect(master);
    body.start(now);
    body.stop(now + 0.18);

    // A breath of filtered noise for the burst itself.
    const noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 0.09, ctx.sampleRate);
    const channel = noiseBuffer.getChannelData(0);
    for (let i = 0; i < channel.length; i += 1) channel[i] = (Math.random() * 2 - 1) * (1 - i / channel.length);
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = "bandpass";
    noiseFilter.frequency.value = 1800;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0.5;
    noise.connect(noiseFilter).connect(noiseGain).connect(master);
    noise.start(now);

    // Three tiny blips, staggered, slightly random: the glitter falling.
    [1240, 1660, 2080].forEach((freq, i) => {
      const blip = ctx.createOscillator();
      blip.type = "triangle";
      blip.frequency.value = freq * (0.96 + Math.random() * 0.08);
      const blipGain = ctx.createGain();
      const at = now + 0.08 + i * 0.06;
      blipGain.gain.setValueAtTime(0.0001, at);
      blipGain.gain.exponentialRampToValueAtTime(0.25, at + 0.012);
      blipGain.gain.exponentialRampToValueAtTime(0.001, at + 0.09);
      blip.connect(blipGain).connect(master);
      blip.start(at);
      blip.stop(at + 0.1);
    });

    // Closing the context releases the hardware; some browsers cap how many
    // can exist, and a leak here would eventually silence the whole app.
    window.setTimeout(() => void ctx.close().catch(() => {}), 600);
  } catch {
    // No audio is an acceptable outcome; a thrown error here is not.
  }
}

/**
 * Burst from the element's rect. Safe to call as the element is unmounting.
 * `colors` should be the project's brand colors; theme tokens fill in when a
 * project has none.
 */
export function explodeFrom(el: HTMLElement, colors: string[] = []): void {
  playPop();
  if (reducedMotion()) return;

  const rect = el.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const palette = [
    ...colors.filter((c) => typeof c === "string" && c.length > 0),
    cssColor("--accent", "#7c9c7c"),
    cssColor("--warning", "#d9a03f"),
    cssColor("--success", "#58a86b"),
  ];

  const overlay = document.createElement("div");
  overlay.className = "celebrate-overlay";
  document.body.appendChild(overlay);

  // The ring: a fast expanding circle, the classic "something happened here".
  const ring = document.createElement("div");
  ring.className = "celebrate-ring";
  ring.style.left = `${cx}px`;
  ring.style.top = `${cy}px`;
  overlay.appendChild(ring);
  ring.animate(
    [
      { transform: "translate(-50%, -50%) scale(0.2)", opacity: 0.9 },
      { transform: "translate(-50%, -50%) scale(1)", opacity: 0 },
    ],
    { duration: 420, easing: "cubic-bezier(0.16, 1, 0.3, 1)" }
  );

  for (let i = 0; i < PARTICLES; i += 1) {
    const particle = document.createElement("div");
    particle.className = "celebrate-particle";
    const size = 4 + Math.random() * 7;
    particle.style.width = `${size}px`;
    particle.style.height = `${size}px`;
    particle.style.background = palette[i % palette.length];
    if (Math.random() < 0.5) particle.style.borderRadius = "50%";
    particle.style.left = `${cx + (Math.random() - 0.5) * rect.width * 0.5}px`;
    particle.style.top = `${cy + (Math.random() - 0.5) * rect.height * 0.5}px`;
    overlay.appendChild(particle);

    // Radial burst, biased upward, then gravity wins. Keyframes sample the
    // arc p(t) = v·t + ½g·t², which reads as physics at this duration.
    const angle = Math.random() * Math.PI * 2;
    const speed = 90 + Math.random() * 200;
    const vx = Math.cos(angle) * speed;
    const vy = Math.sin(angle) * speed - 130;
    const g = 620;
    const t = DURATION_MS / 1000;
    const at = (f: number) =>
      `translate(${vx * t * f}px, ${vy * t * f + 0.5 * g * (t * f) ** 2}px) rotate(${f * (Math.random() < 0.5 ? -1 : 1) * 340}deg)`;
    particle.animate(
      [
        { transform: at(0), opacity: 1 },
        { transform: at(0.35), opacity: 1 },
        { transform: at(0.7), opacity: 0.9 },
        { transform: at(1), opacity: 0 },
      ],
      { duration: DURATION_MS, easing: "cubic-bezier(0.12, 0.6, 0.35, 1)" }
    );
  }

  window.setTimeout(() => overlay.remove(), DURATION_MS + 80);
}
