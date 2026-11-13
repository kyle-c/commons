import { isWebUrl } from "@commons/shared";

/**
 * Open an address outside the app: the system browser from the desktop app,
 * a new tab from the browser app. Web addresses only. What gets opened is
 * often data (a preview address a teammate typed, a deploy GitHub reported,
 * an attachment), and a `javascript:` address handed to window.open runs as
 * this page.
 */
export function openUrl(url: string): void {
  if (!isWebUrl(url)) return;
  if (window.commons) void window.commons.openExternal(url);
  else window.open(url, "_blank", "noopener");
}
