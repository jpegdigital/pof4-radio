import { describe, expect, it } from "vitest";
import { sign } from "./sigv4";

/** The AWS SigV4 test suite's `get-vanilla` case. */
const vector = {
  region: "us-east-1",
  service: "service",
  accessKeyId: "AKIDEXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
  now: new Date("2015-08-30T12:36:00Z"),
};

describe("sign", () => {
  it("matches the AWS get-vanilla test vector", async () => {
    const h = await sign({ ...vector, method: "GET", url: new URL("https://example.amazonaws.com/") });
    expect(h["x-amz-date"]).toBe("20150830T123600Z");
    expect(h.authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31",
    );
  });

  it("matches the get-vanilla-query-order-key case", async () => {
    const h = await sign({
      ...vector,
      method: "GET",
      url: new URL("https://example.amazonaws.com/?Param2=value2&Param1=value1"),
    });
    expect(h.authorization).toContain(
      "Signature=b97d918cfa904a5beff61c982a1b6f458b799221646efd99d3219ec94cdf2500",
    );
  });

  it("hashes a PUT body into x-amz-content-sha256 for S3 and signs the content type", async () => {
    const body = new TextEncoder().encode("hello");
    const h = await sign({
      ...vector,
      service: "s3",
      method: "PUT",
      url: new URL("https://bucket.example.com/radio-clips/stations/a/b/0.mp3"),
      headers: { "Content-Type": "audio/mpeg" },
      body,
    });
    expect(h["x-amz-content-sha256"]).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
    expect(h["content-type"]).toBe("audio/mpeg");
    expect(h.authorization).toContain("SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date");
    expect(h.authorization).toMatch(/Signature=[0-9a-f]{64}$/);
  });
});
