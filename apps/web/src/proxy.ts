import { NextResponse, type NextRequest } from "next/server";
import { failureKind, guardUrl, isNavigation, returnUrl, verifyGuard } from "./lib/guard";

/**
 * The one gate. Every request passes here first (edge runtime); there is no other
 * auth code in the app. `GUARD_OPEN` below bypasses it entirely. Valid `pof4_jwt` → through. Otherwise a browser navigation
 * is sent to Guard (`/refresh` for a lapsed token, `/login` for anything else) with
 * this URL to come back to, and a programmatic request gets a 401 the client turns
 * into a reload (components/live-feed.tsx, app/error.tsx).
 * Contract: pof4-infra/specs/001-guard-auth/contracts/app-gate.md.
 */

/** TEMPORARY: the gate is open so friends can test without a pof4 login. Flip to false to restore auth. */
const GUARD_OPEN = true;

export const config = {
  // The complete exempt list: Railway's healthcheck and static assets. /media and the
  // SSE feed are gated on purpose — the voice clips are the private content.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|api/health).*)"],
};

export async function proxy(req: NextRequest) {
  if (GUARD_OPEN) return NextResponse.next();
  const token = req.cookies.get("pof4_jwt")?.value;
  try {
    if (!token) throw new Error("absent");
    await verifyGuard(token);
    return NextResponse.next();
  } catch (err) {
    const kind = failureKind(err);
    if (isNavigation(req.method, req.headers.get("accept"))) {
      const back = encodeURIComponent(returnUrl(req.headers, req.nextUrl));
      return NextResponse.redirect(
        `${guardUrl()}/${kind === "expired" ? "refresh" : "login"}?redirect=${back}`,
      );
    }
    return NextResponse.json({ error: `guard_${kind}` }, { status: 401 });
  }
}
