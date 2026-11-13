import { isWebUrl } from "@commons/shared";

/**
 * Addresses Commons stores in order to frame them later (a project's
 * preview, its draft pattern, a test's variant) have to be web addresses.
 * The renderer refuses to frame anything else (isWebUrl has the why), and the
 * forms that save these already check; this is the same rule where it cannot
 * be skipped, because a mutation is callable by any member with their own
 * session and no form in between.
 */
export function requireWebUrl(value: string, what: string): string {
  if (!isWebUrl(value)) throw new Error(`${what} has to be a web address, starting with https:// or http://.`);
  return value;
}

/** A "{branch}" pattern, judged as an address it would become. */
export function requireWebPattern(pattern: string, what: string): string {
  requireWebUrl(pattern.replace("{branch}", "branch"), what);
  return pattern;
}
