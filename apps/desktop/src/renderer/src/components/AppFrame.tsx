import type { IframeHTMLAttributes } from "react";
import { frameSandbox } from "@commons/shared";

/**
 * An embedded screen: someone else's running app inside our page. Every one
 * goes through here so none is ever shown unsandboxed (see frameSandbox for
 * what a framed app may and may not do).
 */
export default function AppFrame({
  src,
  ...rest
}: { src: string } & Omit<IframeHTMLAttributes<HTMLIFrameElement>, "src" | "sandbox">) {
  const sandbox = frameSandbox(src, window.location.origin);
  // A frame reads its sandbox only when it navigates, so a changed sandbox
  // gets a new frame rather than an attribute the old document ignores.
  return <iframe key={sandbox} sandbox={sandbox} src={src} {...rest} />;
}
