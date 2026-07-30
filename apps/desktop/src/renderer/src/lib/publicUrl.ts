import { useQuery } from "convex/react";
import { api } from "@commons/backend/convex/_generated/api";
import { getConvexUrl } from "./session";

/**
 * The origin for links a human will see: the branded domain when the
 * deployment has one, else the deployment's own site URL.
 *
 * The fallback is the old behaviour, kept for the moment before the query
 * resolves and for deployments with no custom domain. It is a fallback rather
 * than the default precisely because it is what leaked the raw Convex
 * hostname into shared links.
 */
export function usePublicSiteUrl(): string {
  const configured = useQuery(api.config.publicSiteUrl, {});
  if (configured) return configured.replace(/\/+$/, "");
  return (getConvexUrl() ?? "").replace(".convex.cloud", ".convex.site");
}
