// The Convex runtime exposes deployment environment variables on process.env
// (set via `npx convex env set ...`); this is not Node, so declare just that.
declare const process: { env: Record<string, string | undefined> };
