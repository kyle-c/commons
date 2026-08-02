/**
 * The app's small sound vocabulary. Three utterances, nothing else:
 *
 * - serverUp: two quick notes rising, a fourth apart. "It's on."
 * - serverDown: the same two notes mirrored downward, softer and darker
 *   through a lowpass. "It's off." Mirroring start matters more than novelty:
 *   the pair reads as one device with two states, not two events.
 * - connected: a warm three-note arpeggio with a bell-ish tail, shared by
 *   GitHub, Slack, and Figma alike. One success sound, deliberately — a chime
 *   per service is a zoo, and what the person did is the same act each time:
 *   plugged something in, and it took.
 *
 * Same craft rules as the archive vacuum (lib/celebrate.ts): synthesized in
 * Web Audio so nothing ships in the bundle and every play varies faintly,
 * scheduled a breath after currentTime so a cold audio device doesn't swallow
 * the first one, wrapped so a broken AudioContext can never break the feature
 * it decorates. Quieter than the vacuum on purpose: these mark state changes
 * a person only half-asked for, so they should be felt more than heard.
 *
 * Deliberately NOT gated on prefers-reduced-motion — sound is not motion —
 * but throttled per effect, because a burst of server events (three projects
 * releasing at once) should sound like one thing happening, not a fanfare.
 */

let audio: AudioContext | null = null;
function ctx(): AudioContext | null {
  try {
    if (!audio) audio = new AudioContext();
    if (audio.state === "suspended") void audio.resume();
    return audio;
  } catch {
    return null;
  }
}

/** One utterance per effect per window; repeats inside it stay silent. */
const THROTTLE_MS = 1200;
const lastPlayed = new Map<string, number>();
function throttled(key: string): boolean {
  const now = Date.now();
  const last = lastPlayed.get(key) ?? 0;
  if (now - last < THROTTLE_MS) return true;
  lastPlayed.set(key, now);
  return false;
}

/** A single soft note: sine + a whisper of an octave partial, fast decay. */
function note(
  audioCtx: AudioContext,
  master: GainNode,
  freq: number,
  at: number,
  duration: number,
  peak: number,
  darken?: boolean
): void {
  const osc = audioCtx.createOscillator();
  osc.type = "sine";
  osc.frequency.value = freq;
  const partial = audioCtx.createOscillator();
  partial.type = "sine";
  partial.frequency.value = freq * 2;
  const partialGain = audioCtx.createGain();
  partialGain.gain.value = 0.18;

  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(peak, at + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.001, at + duration);

  let head: AudioNode = gain;
  if (darken) {
    const lp = audioCtx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 900;
    gain.connect(lp);
    head = lp;
  }
  osc.connect(gain);
  partial.connect(partialGain).connect(gain);
  head.connect(master);
  osc.start(at);
  osc.stop(at + duration + 0.05);
  partial.start(at);
  partial.stop(at + duration + 0.05);
}

function master(audioCtx: AudioContext, level: number): GainNode {
  const gain = audioCtx.createGain();
  gain.gain.value = level;
  gain.connect(audioCtx.destination);
  window.setTimeout(() => gain.disconnect(), 1500);
  return gain;
}

/** Dev server reached ready: two quick notes up. */
export function playServerUp(): void {
  if (throttled("up")) return;
  try {
    const audioCtx = ctx();
    if (!audioCtx) return;
    const out = master(audioCtx, 0.14);
    const t0 = audioCtx.currentTime + 0.03;
    const base = 392 + Math.random() * 14; // ~G4, never twice the same
    note(audioCtx, out, base, t0, 0.14, 0.5);
    note(audioCtx, out, base * (4 / 3), t0 + 0.11, 0.2, 0.5); // up a fourth
  } catch {
    // Silence is an acceptable outcome; a thrown error here is not.
  }
}

/** Dev server stopped: the same pair, mirrored down, through a lowpass. */
export function playServerDown(): void {
  if (throttled("down")) return;
  try {
    const audioCtx = ctx();
    if (!audioCtx) return;
    const out = master(audioCtx, 0.11);
    const t0 = audioCtx.currentTime + 0.03;
    const base = 392 + Math.random() * 14;
    note(audioCtx, out, base, t0, 0.14, 0.45, true);
    note(audioCtx, out, base * (3 / 4), t0 + 0.11, 0.22, 0.45, true); // down a fourth
  } catch {
    // As above.
  }
}

/** A connection took (GitHub, Slack, Figma): three notes up, bell tail. */
export function playConnected(): void {
  if (throttled("connected")) return;
  try {
    const audioCtx = ctx();
    if (!audioCtx) return;
    const out = master(audioCtx, 0.13);
    const t0 = audioCtx.currentTime + 0.03;
    const base = 440 + Math.random() * 10;
    // Major triad, gently rolled — the last note rings longest.
    note(audioCtx, out, base, t0, 0.18, 0.4);
    note(audioCtx, out, base * 1.25, t0 + 0.09, 0.2, 0.4);
    note(audioCtx, out, base * 1.5, t0 + 0.18, 0.42, 0.45);
  } catch {
    // As above.
  }
}
