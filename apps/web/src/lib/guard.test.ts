import { describe, expect, it } from "vitest";
import { failureKind, isNavigation, returnUrl } from "./guard";

// The pure half of the gate (contracts/gate.md in specs/001-guard-gate). The
// JWT verification itself needs Guard and is verified in prod, per CLAUDE.md.

describe("isNavigation", () => {
  it("is a GET or HEAD that accepts HTML", () => {
    expect(isNavigation("GET", "text/html,application/xhtml+xml,*/*;q=0.8")).toBe(true);
    expect(isNavigation("HEAD", "text/html,*/*")).toBe(true);
    expect(isNavigation("get", "text/html")).toBe(true);
  });

  it("is not a fetch, a stream, an action, or a bare request", () => {
    expect(isNavigation("GET", "*/*")).toBe(false);
    expect(isNavigation("GET", "text/event-stream")).toBe(false);
    expect(isNavigation("POST", "text/html")).toBe(false);
    expect(isNavigation("GET", null)).toBe(false);
  });
});

describe("returnUrl", () => {
  const url = { protocol: "https:", host: "localhost:8080", pathname: "/books/abc", search: "?x=1" };
  const headers = (h: Record<string, string>) => ({ get: (n: string) => h[n.toLowerCase()] ?? null });

  it("prefers the forwarded public origin over the internal one", () => {
    expect(
      returnUrl(headers({ "x-forwarded-proto": "https", "x-forwarded-host": "dreamweaver.pof4.com" }), url),
    ).toBe("https://dreamweaver.pof4.com/books/abc?x=1");
  });

  it("takes the first of several forwarded values", () => {
    expect(
      returnUrl(headers({ "x-forwarded-proto": "https, http", "x-forwarded-host": "a.pof4.com, edge" }), url),
    ).toBe("https://a.pof4.com/books/abc?x=1");
  });

  it("falls back to the host header, then the request url", () => {
    expect(returnUrl(headers({ host: "dev.dreamweaver.pof4.com:3000" }), url)).toBe(
      "https://dev.dreamweaver.pof4.com:3000/books/abc?x=1",
    );
    expect(returnUrl(headers({}), url)).toBe("https://localhost:8080/books/abc?x=1");
  });
});

describe("failureKind", () => {
  it("only an expired signature-valid token counts as expired", () => {
    expect(failureKind({ code: "ERR_JWT_EXPIRED" })).toBe("expired");
  });

  it("everything else is unauthenticated", () => {
    expect(failureKind({ code: "ERR_JWS_SIGNATURE_VERIFICATION_FAILED" })).toBe("unauthenticated");
    expect(failureKind({ code: "ERR_JWT_CLAIM_VALIDATION_FAILED" })).toBe("unauthenticated");
    expect(failureKind(new Error("absent"))).toBe("unauthenticated");
    expect(failureKind(undefined)).toBe("unauthenticated");
    expect(failureKind("nope")).toBe("unauthenticated");
  });
});
