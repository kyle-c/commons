import { v } from "convex/values";
import { internalAction } from "./_generated/server";

/**
 * Acting *as* the GitHub App, rather than only listening to it.
 *
 * Everything so far has been inbound: GitHub posts a signed webhook, we verify
 * and record it. Opening a pull request is the other direction, and it needs
 * real credentials. GitHub's scheme is two steps:
 *
 *   1. Sign a short-lived JWT with the App's private key. That proves "I am
 *      this App", and it can only read App-level metadata.
 *   2. Trade that JWT for an installation access token, scoped to one
 *      installation. That is what can touch repositories, and it expires in
 *      an hour.
 *
 * The key is never in the repo — GITHUB_APP_PRIVATE_KEY on the deployment, in
 * PKCS#8 form, because Web Crypto refuses the PKCS#1 that GitHub hands you.
 */

const GITHUB_API = "https://api.github.com";

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** PEM body to raw DER, for crypto.subtle.importKey. */
function pemToDer(pem: string): ArrayBuffer {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/, "")
    .replace(/-----END [^-]+-----/, "")
    .replace(/\s+/g, "");
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/**
 * A JWT proving we are the App. RS256, ten-minute life (GitHub's maximum),
 * with `iat` backdated a minute so a little clock drift between us and GitHub
 * cannot make a freshly minted token look like it comes from the future.
 */
async function appJwt(): Promise<string> {
  const appId = process.env.GITHUB_APP_ID;
  const pem = process.env.GITHUB_APP_PRIVATE_KEY;
  if (!appId) throw new Error("GITHUB_APP_ID is not set on this deployment.");
  if (!pem) throw new Error("GITHUB_APP_PRIVATE_KEY is not set on this deployment.");
  if (pem.includes("BEGIN RSA PRIVATE KEY")) {
    throw new Error(
      "GITHUB_APP_PRIVATE_KEY is PKCS#1. Convert it: openssl pkcs8 -topk8 -nocrypt -in key.pem -out key8.pem"
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const payload = base64Url(
    new TextEncoder().encode(JSON.stringify({ iat: now - 60, exp: now + 9 * 60, iss: appId }))
  );
  const signingInput = `${header}.${payload}`;

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToDer(pem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(signingInput));
  return `${signingInput}.${base64Url(new Uint8Array(signature))}`;
}

/**
 * An installation token, which is what can actually act on repositories.
 *
 * Not cached yet. These live an hour and minting one costs an RSA signature
 * plus a round trip, so a cache is worth adding once anything calls this on a
 * hot path; opening a pull request is not that.
 */
export async function installationToken(installationId: number): Promise<string> {
  const response = await fetch(`${GITHUB_API}/app/installations/${installationId}/access_tokens`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await appJwt()}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok) {
    throw new Error(`Couldn't get an installation token (${response.status}): ${await response.text()}`);
  }
  return (await response.json()).token as string;
}

/**
 * Prove the credentials work, without touching a repository.
 *
 * GET /app is the smallest call that requires a valid App JWT, so it separates
 * "the key is wrong" from "the installation is wrong" from "the request was
 * wrong" — three failures that otherwise look identical at the call site.
 */
export const verifyCredentials = internalAction({
  args: {},
  handler: async () => {
    try {
      const response = await fetch(`${GITHUB_API}/app`, {
        headers: {
          Authorization: `Bearer ${await appJwt()}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      });
      if (!response.ok) {
        return { ok: false as const, stage: "jwt", detail: `${response.status}: ${await response.text()}` };
      }
      const app = await response.json();
      return { ok: true as const, appSlug: app.slug as string, appName: app.name as string };
    } catch (error) {
      return { ok: false as const, stage: "signing", detail: error instanceof Error ? error.message : String(error) };
    }
  },
});

/** Exchange for an installation token and report what it can reach. */
export const verifyInstallation = internalAction({
  args: { installationId: v.number() },
  handler: async (_ctx, { installationId }) => {
    try {
      const token = await installationToken(installationId);
      const response = await fetch(`${GITHUB_API}/installation/repositories?per_page=100`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      });
      if (!response.ok) {
        return { ok: false as const, detail: `${response.status}: ${await response.text()}` };
      }
      const body = await response.json();
      return {
        ok: true as const,
        // The answer to "why didn't my deploy show up": whether this
        // installation can see the repo at all.
        repositories: (body.repositories ?? []).map((r: { full_name: string }) => r.full_name),
      };
    } catch (error) {
      return { ok: false as const, detail: error instanceof Error ? error.message : String(error) };
    }
  },
});
