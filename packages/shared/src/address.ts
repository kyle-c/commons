/**
 * Which addresses the Commons server may read when someone pastes a URL.
 *
 * The reader runs on the server, so an address is only useful if the open
 * internet can reach it, and only safe if it is not a way to make the server
 * call something private (its own network, a cloud metadata service). Both
 * come to the same rule: a named, public, https host. The check is on the
 * name alone; it is repeated for every redirect, because a public page can
 * redirect to a private one.
 *
 * The renderer runs the same check for an instant answer, and so the two
 * never disagree about what a valid address is.
 */

export type AddressVerdict =
  | {
      ok: true;
      /** Normalized: https, no fragment, no credentials. */
      url: string;
      origin: string;
      host: string;
      /** Path and query, starting with "/". */
      path: string;
    }
  /** `reason` is a sentence for the person who pasted it. */
  | { ok: false; reason: string };

const LOCAL_ONLY =
  "That address only exists on your own machine or network, so the Commons server can't reach it. Add it in the Mac app instead, which reads it from your machine.";

/** Names that never resolve on the public internet. */
const PRIVATE_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home.arpa", ".test", ".example", ".invalid", ".onion"];

export function publicAddress(raw: string): AddressVerdict {
  const typed = raw.trim();
  if (!typed) return { ok: false, reason: "Paste the address of a running site." };
  // "example.com/app" is an address too; people rarely type the scheme.
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(typed) ? typed : `https://${typed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return { ok: false, reason: "That doesn't read as a web address." };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, reason: "Commons reads web addresses, the kind that start with https." };
  }
  if (url.username || url.password) {
    return { ok: false, reason: "Leave the username and password out of the address." };
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith("[");
  const isLocalName = host === "localhost" || !host.includes(".") || PRIVATE_SUFFIXES.some((suffix) => host.endsWith(suffix));
  if (isIp || isLocalName) return { ok: false, reason: LOCAL_ONLY };
  // Plain http is upgraded rather than refused: a public site that answers on
  // one almost always answers on the other, and the app can only frame https.
  url.protocol = "https:";
  if (url.port === "80") url.port = "";
  url.hash = "";
  return { ok: true, url: url.href, origin: url.origin, host: url.host, path: url.pathname + url.search };
}
