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
import type * as annotations from "../annotations.js";
import type * as auth from "../auth.js";
import type * as cloudAgents from "../cloudAgents.js";
import type * as comments from "../comments.js";
import type * as config from "../config.js";
import type * as emails from "../emails.js";
import type * as errors from "../errors.js";
import type * as figma from "../figma.js";
import type * as github from "../github.js";
import type * as githubApp from "../githubApp.js";
import type * as http from "../http.js";
import type * as invites from "../invites.js";
import type * as landing from "../landing.js";
import type * as metrics from "../metrics.js";
import type * as presence from "../presence.js";
import type * as projects from "../projects.js";
import type * as repoLinks from "../repoLinks.js";
import type * as siteUrl from "../siteUrl.js";
import type * as slack from "../slack.js";
import type * as updateIngest from "../updateIngest.js";
import type * as updates from "../updates.js";
import type * as userTests from "../userTests.js";
import type * as users from "../users.js";
import type * as workspaces from "../workspaces.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  access: typeof access;
  agentSessions: typeof agentSessions;
  annotations: typeof annotations;
  auth: typeof auth;
  cloudAgents: typeof cloudAgents;
  comments: typeof comments;
  config: typeof config;
  emails: typeof emails;
  errors: typeof errors;
  figma: typeof figma;
  github: typeof github;
  githubApp: typeof githubApp;
  http: typeof http;
  invites: typeof invites;
  landing: typeof landing;
  metrics: typeof metrics;
  presence: typeof presence;
  projects: typeof projects;
  repoLinks: typeof repoLinks;
  siteUrl: typeof siteUrl;
  slack: typeof slack;
  updateIngest: typeof updateIngest;
  updates: typeof updates;
  userTests: typeof userTests;
  users: typeof users;
  workspaces: typeof workspaces;
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
