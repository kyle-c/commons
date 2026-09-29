/**
 * Card-cover thumbnails: a small JPEG of a frame capture, so home loads a few
 * dozen kilobytes per screen instead of full-size PNGs. Made here from bytes
 * already in hand: a fresh capture, or a snapshot home had to show at full
 * size (the backfill in ProjectList).
 */
import type { Id } from "@commons/backend/convex/_generated/dataModel";

/** The longest side of a thumbnail. A card shows a screen at ~200px, doubled for Retina. */
export const THUMB_EDGE = 480;

export async function makeThumb(source: Blob, edge = THUMB_EDGE): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(source);
    const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const g = canvas.getContext("2d");
    if (!g) return null;
    g.imageSmoothingQuality = "high";
    g.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return await new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.8));
  } catch {
    // Undecodable or a tainted canvas: the card keeps the full-size image.
    return null;
  }
}

/** POST a blob to a Convex upload URL; the stored file's id, or null. */
export async function uploadBlob(uploadUrl: string, blob: Blob): Promise<Id<"_storage"> | null> {
  const res = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": blob.type }, body: blob });
  if (!res.ok) return null;
  const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
  return storageId;
}
