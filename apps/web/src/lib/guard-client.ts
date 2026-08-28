/**
 * Keeping the Guard cookie alive from a page that stays open for hours.
 *
 * `pof4_jwt` lasts 15 minutes. The gate (proxy.ts) bounces a page navigation through Guard's
 * `/refresh` — which re-mints the cookie and redirects back, no UI — but a `fetch` just gets a
 * 401, and reloading the page to go through that bounce would kill the show. So the refresh
 * bounce is done in a hidden iframe instead: Guard is same-site with every *.pof4.com app, the
 * cookie is `Domain=pof4.com`, and the iframe lands on the exempt `/api/health`. Every fetch
 * goes through `guarded()`, which refreshes and retries once on 401, and `keepGuardAlive()`
 * refreshes proactively so the 401 rarely happens at all.
 */

const GUARD_URL = "https://guard.pof4.com";
const REFRESH_EVERY_MS = 12 * 60_000;
const REFRESH_TIMEOUT_MS = 10_000;

let refreshing: Promise<void> | null = null;

/** Bounce through Guard's /refresh in a hidden iframe. Resolves when the bounce lands (or times out). */
export function refreshGuard(): Promise<void> {
  refreshing ??= new Promise<void>((resolve) => {
    const frame = document.createElement("iframe");
    frame.hidden = true;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      frame.remove();
      refreshing = null;
      resolve();
    };
    const timer = setTimeout(finish, REFRESH_TIMEOUT_MS);
    frame.onload = finish;
    frame.onerror = finish;
    const back = encodeURIComponent(`${location.origin}/api/health`);
    frame.src = `${GUARD_URL}/refresh?redirect=${back}`;
    document.body.appendChild(frame);
  });
  return refreshing;
}

/** `fetch` that survives a lapsed Guard cookie: on 401, refresh once and retry. */
export async function guarded(input: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init);
  if (res.status !== 401) return res;
  await refreshGuard();
  return fetch(input, init);
}

/** Refresh on a timer while the page is open. Returns the cleanup for a `useEffect`. */
export function keepGuardAlive(): () => void {
  const id = setInterval(() => void refreshGuard(), REFRESH_EVERY_MS);
  return () => clearInterval(id);
}
