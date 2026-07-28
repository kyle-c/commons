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

/** The one redirect URI Google must know about. */
export function googleCallbackUrl(): string {
  return `${siteUrl()}/auth/google/callback`;
}
