"use node";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";

/**
 * Release-pipeline escape hatch: when the publisher's machine can't push
 * ~200MB to Convex storage (flaky uplink), the deployment pulls the artifact
 * itself from a signed GitHub release-asset URL. Streams straight through to
 * a storage upload URL — never buffers the file in action memory (buffering
 * 200MB flirted with the runtime limit and failed nondeterministically).
 * Internal-only; used by scripts/publish-update.mjs as a fallback.
 */
export const fromUrl = internalAction({
  args: { url: v.string() },
  handler: async (ctx, { url }) => {
    const uploadUrl: string = await ctx.runMutation(internal.updates.createUploadUrl, {});
    const res = await fetch(url);
    if (!res.ok || !res.body) throw new Error(`asset fetch failed: ${res.status}`);
    const upload = await fetch(uploadUrl, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: res.body,
      // Node fetch requires half-duplex for streamed request bodies.
      duplex: "half",
    } as RequestInit);
    if (!upload.ok) throw new Error(`storage upload failed: ${upload.status} ${await upload.text()}`);
    const { storageId } = (await upload.json()) as { storageId: string };
    const size = Number(res.headers.get("content-length") ?? 0);
    return { storageId, size };
  },
});
