import { createRemoteJWKSet, jwtVerify } from "jose";

/**
 * Guard, the pof4 passkey sign-in, verified locally. After sign-in the browser
 * carries `pof4_jwt`, a 15-minute EdDSA JWT for `.pof4.com`; this module checks
 * it against Guard's published keys (cached, refetched on an unknown `kid`) and
 * never calls Guard per request. Contract: pof4-infra/specs/001-guard-auth/contracts/.
 *
 * Edge-safe on purpose — `proxy.ts` runs on the edge runtime, so nothing here may
 * import `env.ts`, `db`, or anything Node-only. The two variables are read directly:
 * they are URLs, not secrets, and the gate fails closed (throws) without them.
 */

function required(name: "GUARD_URL" | "GUARD_JWKS_URL"): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set (see pof4-infra/docs/guard-integration.md)`);
  return value;
}

/** Guard's origin — issuer of the JWT and home of /login, /refresh, /logout. */
export function guardUrl(): string {
  return required("GUARD_URL");
}

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;

export interface GuardUser {
  id: string;
  name?: string;
}

/** Throws a jose error when the token isn't acceptable; `failureKind` sorts it. */
export async function verifyGuard(token: string): Promise<GuardUser> {
  jwks ??= createRemoteJWKSet(new URL(required("GUARD_JWKS_URL")));
  const { payload } = await jwtVerify(token, jwks, {
    issuer: guardUrl(),
    audience: "pof4",
    algorithms: ["EdDSA"],
    clockTolerance: 30,
  });
  return { id: payload.sub ?? "", name: typeof payload.name === "string" ? payload.name : undefined };
}

/** Browser navigation (GET/HEAD accepting HTML) is redirected; anything else gets a 401. */
export function isNavigation(method: string, accept: string | null): boolean {
  const m = method.toUpperCase();
  return (m === "GET" || m === "HEAD") && (accept ?? "").includes("text/html");
}

/**
 * The URL the browser actually asked for, to send back to after Guard. Behind
 * Railway's edge the request's own URL is the internal one (`https://localhost:8080`);
 * the public scheme and host arrive in the forwarded headers (first value if several).
 * Guard validates the result against `*.pof4.com`, so a spoofed header only earns
 * a redirect to Guard's fallback page.
 */
export function returnUrl(
  headers: { get(name: string): string | null },
  url: { protocol: string; host: string; pathname: string; search: string },
): string {
  const first = (v: string | null) => v?.split(",")[0]?.trim() || undefined;
  const proto = first(headers.get("x-forwarded-proto")) ?? url.protocol.replace(/:$/, "");
  const host = first(headers.get("x-forwarded-host")) ?? first(headers.get("host")) ?? url.host;
  return `${proto}://${host}${url.pathname}${url.search}`;
}

/** Expired-but-genuine tokens refresh silently; every other failure means sign in. */
export function failureKind(err: unknown): "expired" | "unauthenticated" {
  const code = typeof err === "object" && err !== null ? (err as { code?: unknown }).code : undefined;
  return code === "ERR_JWT_EXPIRED" ? "expired" : "unauthenticated";
}
