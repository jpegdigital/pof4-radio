import { describe, expect, it } from "vitest";
import { clipUrl, type Manifest, toElements } from "./manifest";

const t = (id: string) => ({
  uri: `spotify:track:${id}`,
  name: id,
  artists: [id],
  album: id,
  image: null,
  durationMs: 1,
});
const m: Manifest = {
  station: "WFAI",
  dj: "D",
  voiceId: "v",
  songs: [t("1"), t("2"), t("3"), t("4"), t("5")],
  bed: t("bed"),
  clips: {
    "break-small": { text: "", durationMs: 20000 },
    "break-big": { text: "", durationMs: 54000, bedInMs: 5800, leadMs: 6100 },
  },
};

describe("toElements", () => {
  it("lays out the practice program", () => {
    const els = toElements(m);
    expect(els.map((e) => e.kind)).toEqual(["break", "song", "song", "song", "song", "break", "song"]);
    expect(els[0]).toMatchObject({ clip: "break-small", bed: "bed", leadMs: 0 });
    expect(els[1]).toMatchObject({ track: t("1") });
    expect(els[1]).not.toHaveProperty("talk");
    expect(els[2]).toMatchObject({ track: t("2"), talk: { clip: "talkup-2", over: "intro" } });
    expect(els[5]).toMatchObject({ clip: "break-big", bed: "bed", bedInMs: 5800, leadMs: 6100 });
    expect(els[6]).toMatchObject({ track: t("5") });
    expect(els[6]).not.toHaveProperty("talk");
  });
  it("needs five songs", () => {
    expect(() => toElements({ ...m, songs: m.songs.slice(0, 4) })).toThrow();
  });
  it("names clip urls under /program", () => {
    expect(clipUrl("legal-id")).toBe("/program/legal-id.mp3");
  });
});
