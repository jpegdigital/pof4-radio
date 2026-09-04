import { describe, expect, it } from "vitest";
import { fileUrlSig, parseBundle, toTrack } from "./qobuz";

/**
 * A stand-in for play.qobuz.com's bundle.js: the three shapes the scrape reads, with secrets built
 * the way the web player hides them — seed + info + extras is base64 with 44 junk chars appended.
 */
const junk = "x".repeat(44);
const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
function bundle(zones: { tz: string; secret: string }[], appId = "798273057") {
  let js = `production:{api:{appId:"${appId}",appSecret:"${"a".repeat(32)}"},`;
  for (const { tz, secret } of zones) {
    const whole = b64(secret) + junk;
    const seed = whole.slice(0, 5);
    const info = whole.slice(5, 9);
    const extras = whole.slice(9);
    js += `t.initialSeed("${seed}",window.utimezone.${tz});`;
    js += `{name:"Europe/${tz[0].toUpperCase()}${tz.slice(1)}",info:"${info}",extras:"${extras}"},`;
  }
  return js;
}

describe("parseBundle", () => {
  it("reads the app id and every zone's secret, in bundle order", () => {
    const out = parseBundle(
      bundle([
        { tz: "berlin", secret: "abidjan" },
        { tz: "london", secret: "hunter22" },
      ]),
    );
    expect(out).toEqual({ appId: "798273057", secrets: ["abidjan", "hunter22"] });
  });

  it("skips a zone whose info/extras are missing", () => {
    const js = `${bundle([{ tz: "berlin", secret: "abidjan" }])}t.initialSeed("QUJD",window.utimezone.paris);`;
    expect(parseBundle(js).secrets).toEqual(["abidjan"]);
  });

  it.each([
    ["no app id", `t.initialSeed("QUJD",window.utimezone.paris);`, /app id/],
    ["no seeds", `production:{api:{appId:"123456789",appSecret:"${"a".repeat(32)}"}`, /secret/],
  ])("throws on %s", (_id, js, want) => {
    expect(() => parseBundle(js)).toThrow(want);
  });
});

describe("fileUrlSig", () => {
  it("is the md5 of the fixed string the web player signs", () => {
    // md5("trackgetFileUrlformat_id5intentstreamtrack_id59667831700000000abidjan")
    expect(fileUrlSig("5966783", 5, 1700000000, "abidjan")).toBe("dd9e458ddaa7341bef4fd656c0155041");
  });

  it.each([
    ["the secret", fileUrlSig("5966783", 5, 1700000000, "london")],
    ["the clock", fileUrlSig("5966783", 5, 1700000001, "abidjan")],
    ["the track", fileUrlSig("5966784", 5, 1700000000, "abidjan")],
  ])("changes with %s", (_id, other) => {
    expect(other).not.toBe("dd9e458ddaa7341bef4fd656c0155041");
  });
});

describe("toTrack", () => {
  const raw = {
    id: 19512574,
    title: "Dreams",
    version: "2001 Remaster",
    duration: 258,
    streamable: true,
    performer: { name: "Fleetwood Mac" },
    album: {
      title: "Rumours",
      artist: { name: "Fleetwood Mac" },
      image: { small: "s.jpg", thumbnail: "t.jpg", large: "l.jpg" },
    },
  };

  it("flattens the hit to the playlist's shape", () => {
    expect(toTrack(raw)).toEqual({
      id: "19512574",
      title: "Dreams (2001 Remaster)",
      artists: ["Fleetwood Mac"],
      album: "Rumours",
      image: "l.jpg",
      durationMs: 258_000,
      streamable: true,
    });
  });

  it.each([
    ["no version", { ...raw, version: null }, "Dreams"],
    ["blank version", { ...raw, version: "" }, "Dreams"],
  ])("title with %s", (_id, give, want) => {
    expect(toTrack(give).title).toBe(want);
  });

  it("names the album artist too when it is not the performer", () => {
    expect(toTrack({ ...raw, album: { ...raw.album, artist: { name: "Various Artists" } } }).artists).toEqual(
      ["Fleetwood Mac", "Various Artists"],
    );
  });

  it("has no image when the album has none", () => {
    expect(toTrack({ ...raw, album: { ...raw.album, image: null } }).image).toBeNull();
  });
});
