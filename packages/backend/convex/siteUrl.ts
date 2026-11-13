/**
 * The public origin for links we hand to people and to Google.
 *
 * PUBLIC_SITE_URL is the branded custom domain (trycommons.app); when it is
 * unset we fall back to the deployment's own .convex.site URL, so dev and any
 * un-branded deployment keep working untouched.
 *
 * Order of operations matters when changing this: the value must already be
 * registered as an authorized redirect URI in Google Cloud Console, or every
 * sign-in fails with redirect_uri_mismatch. The authorize request and the
 * token exchange must also agree exactly, which is why both read from here.
 */
export function siteUrl(): string {
  const url = process.env.PUBLIC_SITE_URL ?? process.env.CONVEX_SITE_URL ?? "";
  return url.replace(/\/+$/, "");
}

/**
 * The origin that serves Commons-hosted previews, kept apart from the one
 * that serves the app (hostSplit.ts has the why). The deployment's own
 * .convex.site host by default, which differs from PUBLIC_SITE_URL wherever
 * a branded domain is set; PREVIEW_SITE_URL names a dedicated host when
 * there is one. Convex routes every host to the same functions, so this
 * needs no DNS of its own.
 */
export function previewSiteUrl(): string {
  const url = process.env.PREVIEW_SITE_URL ?? process.env.CONVEX_SITE_URL ?? "";
  return url.replace(/\/+$/, "");
}

/** The one redirect URI Google must know about. */
export function googleCallbackUrl(): string {
  return `${siteUrl()}/auth/google/callback`;
}
