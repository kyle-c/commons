import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { buildAuthCallbackUrl } from "@commons/shared";

const http = httpRouter();

// Google's authorization-code redirect. Exchanges the code, records the result
// on the authSession, then bounces the browser back into the app via the
// commons:// deep link (with the live `auth.status` query as the fallback path).
http.route({
  path: "/auth/google/callback",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const state = url.searchParams.get("state");
    const code = url.searchParams.get("code");
    const oauthError = url.searchParams.get("error");

    if (!state) return page("Sign-in failed", "The sign-in link is malformed. Return to Commons and try again.");
    if (oauthError || !code) {
      await ctx.runMutation(internal.auth.failAuthSession, { state, error: oauthError ?? "no_code" });
      return page("Sign-in cancelled", "Google didn't complete the sign-in. Return to Commons and try again.");
    }

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        code,
        grant_type: "authorization_code",
        redirect_uri: `${process.env.CONVEX_SITE_URL}/auth/google/callback`,
      }),
    });
    if (!tokenRes.ok) {
      console.error("Google token exchange failed", tokenRes.status, await tokenRes.text());
      await ctx.runMutation(internal.auth.failAuthSession, { state, error: "token_exchange_failed" });
      return page("Sign-in failed", "Google rejected the sign-in. Return to Commons and try again.");
    }

    // The id_token comes straight from Google's token endpoint over TLS, so its
    // claims are trusted without re-verifying the signature.
    const { id_token } = (await tokenRes.json()) as { id_token: string };
    const claims = decodeJwtPayload(id_token) as {
      email?: string;
      email_verified?: boolean;
      name?: string;
      picture?: string;
      sub: string;
    };
    if (!claims.email || claims.email_verified === false) {
      await ctx.runMutation(internal.auth.failAuthSession, { state, error: "unverified_email" });
      return page("Sign-in failed", "That Google account has no verified email address.");
    }

    const result = await ctx.runMutation(internal.auth.completeGoogleSignIn, {
      state,
      email: claims.email,
      name: claims.name ?? claims.email.split("@")[0],
      googleId: claims.sub,
      avatarUrl: claims.picture,
    });
    if (!result.ok) {
      if (result.reason === "not_invited") {
        return page(
          "You need an invite",
          `Commons is invite-only. Ask a teammate to invite ${claims.email} (Team menu in the app), then sign in again.`
        );
      }
      return page("Sign-in expired", "This sign-in took too long. Return to Commons and try again.");
    }

    return page("Signed in", "Returning you to Commons — you can close this tab.", buildAuthCallbackUrl(state));
  }),
});

function decodeJwtPayload(jwt: string): unknown {
  const base64 = jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(atob(base64));
}

function page(title: string, body: string, deepLink?: string): Response {
  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${title} — Commons</title>
${deepLink ? `<meta http-equiv="refresh" content="0;url=${deepLink}" />` : ""}
<style>
  body { margin: 0; height: 100vh; display: flex; align-items: center; justify-content: center;
         background: #101012; color: #e7e7ea; font: 15px/1.6 -apple-system, system-ui, sans-serif; }
  .card { max-width: 420px; padding: 32px; background: #18181b; border: 1px solid #2a2a2f; border-radius: 12px; }
  h1 { font-size: 18px; margin: 0 0 8px; }
  p { margin: 0; color: #a1a1a8; }
  a { color: #7c9cf5; }
</style>
</head>
<body>
<div class="card">
  <h1>${title}</h1>
  <p>${body}</p>
  ${deepLink ? `<p style="margin-top:12px"><a href="${deepLink}">Open Commons</a> if it doesn't open automatically.</p>` : ""}
</div>
${deepLink ? `<script>location.href = ${JSON.stringify(deepLink)};</script>` : ""}
</body>
</html>`;
  return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

export default http;
