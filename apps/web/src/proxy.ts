import { NextResponse, type NextRequest } from "next/server";
import { failureKind, guardUrl, isNavigation, returnUrl, verifyGuard } from "./lib/guard";

/**
 * The one gate. Every request passes here first (edge runtime); there is no other
 * auth code in the app. Valid `pof4_jwt` → through. Otherwise a browser navigation
 * is sent to Guard (`/refresh` for a lapsed token, `/login` for anything else) with
 * this URL to come back to, and a programmatic request gets a 401 the client turns
 * into a reload (components/live-feed.tsx, app/error.tsx).
 * Contract: pof4-infra/specs/001-guard-auth/contracts/app-gate.md.
 */

export const config = {
  // The complete exempt list: Railway's healthcheck and static assets. /media and the
  // SSE feed are gated on purpose — the voice clips are the private content.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|api/health).*)"],
};

export async function proxy(req: NextRequest) {
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
