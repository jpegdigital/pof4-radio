/**
 * Spotify's two OAuth flows (developer.spotify.com/documentation/web-api/concepts/authorization).
 *
 *  - client credentials: app-only token, good for search/lookup. The worker's flow.
 *  - authorization code: the *user's* token; playback (Web Playback SDK + /me/player) needs it,
 *    and the account must be Premium. The web app's flow; the refresh token lives in Postgres.
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

async function tokenRequest(cfg: ClientConfig, form: Record<string, string>): Promise<TokenResponse> {
  const basic = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64");
  const res = await fetch(`${ACCOUNTS}/api/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form),
  });
  const body = await res.text();
  if (!res.ok) throw new SpotifyAuthError(`spotify token request failed (${res.status})`, res.status, body);
  return JSON.parse(body) as TokenResponse;
}

/** App-only token (about an hour). Callers cache it per `expires_in`; this does not. */
export const clientCredentialsToken = (cfg: ClientConfig) =>
  tokenRequest(cfg, { grant_type: "client_credentials" });

/** What playback through the Web Playback SDK and /me/player needs, plus who the user is. */
export const PLAYBACK_SCOPES = [
  "streaming",
  "user-read-email",
  "user-read-private",
  "user-read-playback-state",
  "user-modify-playback-state",
] as const;

export function authorizeUrl(
  cfg: Pick<ClientConfig, "clientId">,
  redirectUri: string,
  state: string,
  scopes: readonly string[] = PLAYBACK_SCOPES,
): string {
  const q = new URLSearchParams({
    response_type: "code",
    client_id: cfg.clientId,
    scope: scopes.join(" "),
    redirect_uri: redirectUri,
    state,
  });
  return `${ACCOUNTS}/authorize?${q.toString()}`;
}

export const exchangeCode = (cfg: ClientConfig, code: string, redirectUri: string) =>
  tokenRequest(cfg, { grant_type: "authorization_code", code, redirect_uri: redirectUri });

/** Spotify may or may not rotate the refresh token on refresh; keep whichever comes back. */
export const refreshToken = (cfg: ClientConfig, refresh: string) =>
  tokenRequest(cfg, { grant_type: "refresh_token", refresh_token: refresh });
