/**
 * The browser's own Spotify account. Playback (the Web Playback SDK and /me/player) needs the
 * *user's* token and a Premium account; the authorization-code flow with PKCE needs no secret,
 * so the whole thing lives here: consent → code → tokens in localStorage, refreshed in place
 * when they lapse. Each visitor plays through their own account; the server never sees a user
 * token. Plain fetch + Web Crypto, no SDK.
 *
 * Who is connected (id, name, product — never a token) is also kept in a cookie, so a page can
 * render the name and the Premium gate on first paint instead of a frame later.
 */

const ACCOUNTS = "https://accounts.spotify.com";
const API = "https://api.spotify.com/v1";

/** What playback through the Web Playback SDK and /me/player needs, plus who the user is. */
const PLAYBACK_SCOPES = [
  "streaming",
  "user-read-email",
  "user-read-private",
  "user-read-playback-state",
  "user-modify-playback-state",
];

/** Who is connected — the part of the account the server may see and the page renders first. */
export interface SpotifyIdentity {
  spotifyUserId: string;
  displayName: string | null;
  product: string | null;
}

export interface SpotifyAccount extends SpotifyIdentity {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms. */
  expiresAt: number;
}

/** The localStorage key the account lives under (read raw by pages that must hydrate first). */
export const ACCOUNT_KEY = "radio.spotify";
/** The identity cookie a server page may read. */
export const IDENTITY_COOKIE = "radio.spotify.who";
const FLOW_KEY = "radio.spotify.flow"; // sessionStorage: { state, verifier } across the redirect

export const CALLBACK_PATH = "/spotify/callback";
const redirectUri = () => `${location.origin}${CALLBACK_PATH}`;

// ── the account, kept ────────────────────────────────────────────────────────────────────────

export function loadAccount(): SpotifyAccount | null {
  try {
    const raw = localStorage.getItem(ACCOUNT_KEY);
    return raw ? (JSON.parse(raw) as SpotifyAccount) : null;
  } catch {
    return null;
  }
}

export const identityOf = (a: SpotifyAccount): SpotifyIdentity => ({
  spotifyUserId: a.spotifyUserId,
  displayName: a.displayName,
  product: a.product,
});

function saveAccount(a: SpotifyAccount): void {
  try {
    localStorage.setItem(ACCOUNT_KEY, JSON.stringify(a));
  } catch {
    // storage unavailable — the connection just won't survive a reload
  }
  rememberIdentity(a);
}

/** Write the identity cookie for the page's first paint (also backfills a browser from before the cookie). */
export function rememberIdentity(a: SpotifyAccount): void {
  document.cookie = `${IDENTITY_COOKIE}=${encodeURIComponent(JSON.stringify(identityOf(a)))}; Path=/; Max-Age=31536000; SameSite=Lax; Secure`;
}

export function clearAccount(): void {
  try {
    localStorage.removeItem(ACCOUNT_KEY);
  } catch {
    // nothing to clear
  }
  document.cookie = `${IDENTITY_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax; Secure`;
}

/** The identity cookie's value, as the server reads it; null if absent or not ours. */
export function parseIdentity(raw: string | undefined): SpotifyIdentity | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(decodeURIComponent(raw)) as Partial<SpotifyIdentity>;
    return typeof v.spotifyUserId === "string"
      ? { spotifyUserId: v.spotifyUserId, displayName: v.displayName ?? null, product: v.product ?? null }
      : null;
  } catch {
    return null;
  }
}

// ── the PKCE flow ────────────────────────────────────────────────────────────────────────────

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
}

class SpotifyAuthError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = "SpotifyAuthError";
  }
}

async function tokenRequest(form: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(`${ACCOUNTS}/api/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form),
  });
  const body = await res.text();
  if (!res.ok) throw new SpotifyAuthError(`spotify token request failed (${res.status})`, res.status, body);
  return JSON.parse(body) as TokenResponse;
}

const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

/** "Connect Spotify": remember the PKCE verifier + nonce, send the tab to the consent page. */
export async function beginLogin(clientId: string): Promise<void> {
  const state = crypto.randomUUID();
  // A fresh verifier (43–128 chars of [A-Za-z0-9-._~]); base64url of 64 random bytes fits.
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(64)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  sessionStorage.setItem(FLOW_KEY, JSON.stringify({ state, verifier }));
  const q = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    scope: PLAYBACK_SCOPES.join(" "),
    redirect_uri: redirectUri(),
    state,
    code_challenge_method: "S256",
    code_challenge: base64url(new Uint8Array(digest)),
  });
  location.assign(`${ACCOUNTS}/authorize?${q.toString()}`);
}

/** The callback page: check the nonce, trade the code for tokens, look up who it is. */
export async function finishLogin(clientId: string, params: URLSearchParams): Promise<SpotifyAccount> {
  const raw = sessionStorage.getItem(FLOW_KEY);
  sessionStorage.removeItem(FLOW_KEY);
  const flow = raw ? (JSON.parse(raw) as { state: string; verifier: string }) : null;

  const error = params.get("error");
  if (error) throw new Error(error);
  const code = params.get("code");
  if (!code || !flow || params.get("state") !== flow.state) throw new Error("state_mismatch");

  const t = await tokenRequest({
    grant_type: "authorization_code",
    client_id: clientId,
    code,
    redirect_uri: redirectUri(),
    code_verifier: flow.verifier,
  });
  if (!t.refresh_token) throw new Error("no_refresh_token");
  const res = await fetch(`${API}/me`, { headers: { Authorization: `Bearer ${t.access_token}` } });
  const body = await res.text();
  if (!res.ok) throw new SpotifyAuthError(`spotify /me failed (${res.status})`, res.status, body);
  // product is "premium" | "free" | … (needs user-read-private); playback needs premium.
  const who = JSON.parse(body) as { id: string; display_name: string | null; product?: string };
  const account: SpotifyAccount = {
    spotifyUserId: who.id,
    displayName: who.display_name,
    product: who.product ?? null,
    accessToken: t.access_token,
    refreshToken: t.refresh_token,
    expiresAt: Date.now() + t.expires_in * 1000,
  };
  saveAccount(account);
  return account;
}

let refreshing: Promise<string> | null = null;

/**
 * A usable access token, refreshed first when within a minute of expiring. Concurrent callers
 * (the SDK and a play() at once) share one refresh — PKCE rotates the refresh token, so two
 * racing refreshes would kill each other; always keep the one that comes back.
 */
export function accessToken(clientId: string): Promise<string> {
  const account = loadAccount();
  if (!account) return Promise.reject(new Error("spotify_not_connected"));
  if (account.expiresAt - Date.now() > 60_000) return Promise.resolve(account.accessToken);
  refreshing ??= tokenRequest({
    grant_type: "refresh_token",
    client_id: clientId,
    refresh_token: account.refreshToken,
  })
    .then((t) => {
      saveAccount({
        ...account,
        accessToken: t.access_token,
        refreshToken: t.refresh_token ?? account.refreshToken,
        expiresAt: Date.now() + t.expires_in * 1000,
      });
      return t.access_token;
    })
    .catch((err: unknown) => {
      // A dead refresh token (revoked, or lost to a rotation race) means "connect again".
      if (err instanceof SpotifyAuthError && err.status === 400) clearAccount();
      throw err;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}
