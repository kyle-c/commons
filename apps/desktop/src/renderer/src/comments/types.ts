import type { Doc } from "@commons/backend/convex/_generated/dataModel";

export type MessageWithAuthor = Doc<"messages"> & { author: Doc<"users"> | null };
export type ThreadWithMessages = Doc<"threads"> & { messages: MessageWithAuthor[] };
