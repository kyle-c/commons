import type { Doc } from "@commons/backend/convex/_generated/dataModel";

/**
 * As much of a person as anyone needs to render a comment.
 *
 * A full user doc satisfies this, so signed-in code is unaffected — but guest
 * mode can supply it too, which means share-token data never has to carry
 * email addresses to type-check.
 */
export type PublicUser = Pick<Doc<"users">, "_id" | "name" | "avatarColor" | "avatarUrl">;

export type MessageWithAuthor = Doc<"messages"> & {
  author: PublicUser | null; // null + guestName = web-share guest comment
  /** Resolved URLs for attached images (agent before/after snapshots). */
  imageUrls?: string[];
};
export type ThreadWithMessages = Doc<"threads"> & { messages: MessageWithAuthor[] };
