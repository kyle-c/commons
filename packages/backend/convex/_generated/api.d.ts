/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as access from "../access.js";
import type * as agentSessions from "../agentSessions.js";
import type * as auth from "../auth.js";
import type * as comments from "../comments.js";
import type * as emails from "../emails.js";
import type * as http from "../http.js";
import type * as invites from "../invites.js";
import type * as presence from "../presence.js";
import type * as projects from "../projects.js";
import type * as repoLinks from "../repoLinks.js";
import type * as updates from "../updates.js";
import type * as userTests from "../userTests.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  access: typeof access;
  agentSessions: typeof agentSessions;
  auth: typeof auth;
  comments: typeof comments;
  emails: typeof emails;
  http: typeof http;
  invites: typeof invites;
  presence: typeof presence;
  projects: typeof projects;
  repoLinks: typeof repoLinks;
  updates: typeof updates;
  userTests: typeof userTests;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
