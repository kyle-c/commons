import { isWebUrl, type DevServerStatus } from "@commons/shared";

export interface FrameSource {
  url: string;
  /** True when served by the local dev server; false for a deployed preview. */
  live: boolean;
}

/**
 * Where a route frame renders from: the local dev server when it's running,
 * else the project's deployed preview, else nothing (placeholder). A preview
 * address that is not a web address counts as nothing: it is stored data,
 * and a `javascript:` one would run as this page if framed.
 */
export function resolveFrameUrl(
  routePath: string | undefined,
  devStatus: DevServerStatus,
  previewUrl: string | undefined | null
): FrameSource | null {
  const route = routePath ?? "/";
  if (devStatus.state === "ready") return { url: `${devStatus.url}${route}`, live: true };
  if (previewUrl && isWebUrl(previewUrl)) return { url: `${previewUrl.replace(/\/+$/, "")}${route}`, live: false };
  return null;
}
