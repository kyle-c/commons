import type { IframeHTMLAttributes } from "react";
import { frameSandbox, isWebUrl } from "@commons/shared";

/**
 * An embedded screen: someone else's running app inside our page. Every one
 * goes through here so none is ever shown unsandboxed (see frameSandbox for
 * what a framed app may and may not do).
 */
export default function AppFrame({
  src,
  ...rest
}: { src: string } & Omit<IframeHTMLAttributes<HTMLIFrameElement>, "src" | "sandbox">) {
  // Not a place, so not framed: see isWebUrl. The callers resolve addresses
  // through resolveFrameUrl, which already refuses these; this is the backstop.
  if (!isWebUrl(src)) return null;
  const sandbox = frameSandbox(src, window.location.origin);
  // A frame reads its sandbox only when it navigates, so a changed sandbox
  // gets a new frame rather than an attribute the old document ignores.
  return <iframe key={sandbox} sandbox={sandbox} src={src} {...rest} />;
}
