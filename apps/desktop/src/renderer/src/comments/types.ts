import type { Doc } from "@commons/backend/convex/_generated/dataModel";

export type MessageWithAuthor = Doc<"messages"> & {
  author: Doc<"users"> | null;
  /** Resolved URLs for attached images (agent before/after snapshots). */
  imageUrls?: string[];
};
export type ThreadWithMessages = Doc<"threads"> & { messages: MessageWithAuthor[] };
