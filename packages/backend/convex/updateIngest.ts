"use node";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";

/**
 * Release-pipeline escape hatch: when the publisher's machine can't push
 * ~200MB to Convex storage (flaky uplink), the deployment pulls the artifact
 * itself from a signed GitHub release-asset URL. Internal-only; called by
 * scripts/publish-update.mjs as a fallback.
 */
export const fromUrl = internalAction({
  args: { url: v.string() },
  handler: async (ctx, { url }) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`asset fetch failed: ${res.status}`);
    const blob = await res.blob();
    const storageId = await ctx.storage.store(blob);
    return { storageId, size: blob.size };
  },
});
