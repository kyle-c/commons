/**
 * Imperative toast — the app's answer to alert(): the same one-line urgency
 * without the modal jolt that steals focus and blocks the render loop.
 * Framework-free on purpose so any module (views, canvas, IPC glue) can call
 * it without threading a hook through props.
 *
 * Toasts stack bottom-center, dismiss themselves, and dismiss sooner on
 * click. Errors linger a little longer and announce via role="alert".
 */
let host: HTMLDivElement | null = null;

function ensureHost(): HTMLDivElement {
  if (host && document.body.contains(host)) return host;
  host = document.createElement("div");
  host.className = "toast-host";
  document.body.appendChild(host);
  return host;
}

export function toast(message: string, opts?: { tone?: "info" | "error" }) {
  const tone = opts?.tone ?? "info";
  const el = document.createElement("div");
  el.className = `toast ${tone}`;
  el.textContent = message;
  el.setAttribute("role", tone === "error" ? "alert" : "status");
  let gone = false;
  const dismiss = () => {
    if (gone) return;
    gone = true;
    el.classList.add("leaving");
    window.setTimeout(() => el.remove(), 240);
  };
  el.addEventListener("click", dismiss);
  ensureHost().appendChild(el);
  window.setTimeout(dismiss, tone === "error" ? 7000 : 4800);
}
