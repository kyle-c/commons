/**
 * A tiny emoji explosion at a point: six copies fly outward and fade, the
 * clicked feeling made visible. Fire-and-forget, compositor-only (transform +
 * opacity), self-removing, skipped under reduced motion.
 */
export function burstEmoji(x: number, y: number, emoji: string): void {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const host = document.createElement("div");
  host.className = "emoji-burst";
  host.style.left = `${x}px`;
  host.style.top = `${y}px`;
  for (let i = 0; i < 6; i += 1) {
    const bit = document.createElement("span");
    bit.textContent = emoji;
    const angle = (Math.PI * 2 * i) / 6 + Math.random() * 0.6;
    const distance = 34 + Math.random() * 26;
    bit.style.setProperty("--dx", `${Math.cos(angle) * distance}px`);
    bit.style.setProperty("--dy", `${Math.sin(angle) * distance - 18}px`);
    bit.style.animationDelay = `${Math.random() * 60}ms`;
    host.appendChild(bit);
  }
  document.body.appendChild(host);
  window.setTimeout(() => host.remove(), 750);
}
