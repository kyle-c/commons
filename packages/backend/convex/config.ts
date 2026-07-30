import { query } from "./_generated/server";
import { siteUrl } from "./siteUrl";

/**
 * The origin to put in links people will see.
 *
 * The client used to build share and test links by string-munging its own
 * Convex deployment URL (".convex.cloud" → ".convex.site"), which produced a
 * working link wearing the wrong name: rapid-anteater-106.convex.site in
 * something you paste into Slack for a stakeholder.
 *
 * PUBLIC_SITE_URL only exists on the deployment, so the client has to ask.
 * Asking also means the branded domain can change without rebuilding and
 * reshipping every client, and dev keeps working untouched because siteUrl()
 * falls back to CONVEX_SITE_URL there.
 *
 * Open by design: this is a public constant. It is the address of the front
 * door, which is on the marketing page and in every share link already.
 */
export const publicSiteUrl = query({
  args: {},
  handler: () => siteUrl(),
});
