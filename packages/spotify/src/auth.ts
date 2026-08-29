/**
 * Spotify's two OAuth flows (developer.spotify.com/documentation/web-api/concepts/authorization).
 *
 *  - client credentials: app-only token, good for search/lookup. Needs the secret; server only.
 *  - authorization code with PKCE: the *user's* token; playback (Web Playback SDK + /me/player)
 *    needs it, and the account must be Premium. No secret involved, so the browser runs the
 *    whole flow itself and keeps its own tokens: every visitor plays through their own account.
 *
 * Everything here is plain `fetch` + Web Crypto so it runs in Node and the browser alike.
 */

const ACCOUNTS = "https://accounts.spotify.com";

export interface ClientConfig {
  clientId: string;
  clientSecret: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: "Bearer";
  scope?: string;
  expires_in: number;
  refresh_token?: string;
}

export class SpotifyAuthError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
  }
}

async function tokenRequest(form: Record<string, string>, basicAuth?: string): Promise<TokenResponse> {
  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
  if (basicAuth) headers.Authorization = `Basic ${basicAuth}`;
  const res = await fetch(`${ACCOUNTS}/api/token`, {
    method: "POST",
    headers,
    body: new URLSearchParams(form),
  });
  const body = await res.text();
  if (!res.ok) throw new SpotifyAuthError(`spotify token request failed (${res.status})`, res.status, body);
  return JSON.parse(body) as TokenResponse;
}

/** App-only token (about an hour). Callers cache it per `expires_in`; this does not. */
export const clientCredentialsToken = (cfg: ClientConfig) =>
  tokenRequest({ grant_type: "client_credentials" }, btoa(`${cfg.clientId}:${cfg.clientSecret}`));

// ---- authorization code + PKCE (the browser's flow) -------------------------------

/** What playback through the Web Playback SDK and /me/player needs, plus who the user is. */
export const PLAYBACK_SCOPES = [
  "streaming",
  "user-read-email",
  "user-read-private",
  "user-read-playback-state",
  "user-modify-playback-state",
] as const;

const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

/** A fresh PKCE verifier (43–128 chars of [A-Za-z0-9-._~]); base64url of 64 random bytes fits. */
export const pkceVerifier = (): string => base64url(crypto.getRandomValues(new Uint8Array(64)));

export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

export function authorizeUrl(
  clientId: string,
  redirectUri: string,
  state: string,
  codeChallenge: string,
  scopes: readonly string[] = PLAYBACK_SCOPES,
): string {
  const q = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    scope: scopes.join(" "),
    redirect_uri: redirectUri,
    state,
    code_challenge_method: "S256",
    code_challenge: codeChallenge,
  });
  return `${ACCOUNTS}/authorize?${q.toString()}`;
}

export const exchangeCode = (clientId: string, code: string, redirectUri: string, codeVerifier: string) =>
  tokenRequest({
    grant_type: "authorization_code",
    client_id: clientId,
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  });

/** PKCE refreshes rotate the refresh token: always keep the one that comes back. */
export const refreshToken = (clientId: string, refresh: string) =>
  tokenRequest({ grant_type: "refresh_token", client_id: clientId, refresh_token: refresh });
