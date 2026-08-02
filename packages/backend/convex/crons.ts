import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

/**
 * The backend's only clock. Everything else in Commons is event-driven
 * (webhooks, mutations, schedulers chained off them); the one thing events
 * cannot do is notice that they stopped arriving. That absence is what this
 * measures.
 */
const crons = cronJobs();

// Open question #4's close: a session orphaned by a crashed or closed host
// used to stay "running" until that host next launched, which over a weekend
// is days of a spinner nobody can stop. Cloud sessions have no host at all.
crons.interval("finalize stalled agent sessions", { minutes: 10 }, internal.agentSessions.finalizeStalled, {});

export default crons;
