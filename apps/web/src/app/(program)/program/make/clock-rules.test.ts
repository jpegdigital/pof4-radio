import { describe, expect, it } from "vitest";
import { checkLog, hourAtSeqOf, MIN_TALKUP_INTRO_MS, type RawSlot } from "./clock-rules";
import type { Card, Record } from "./shapes";

const rec = (id: string, durationMs = 200_000): Record => ({
  id,
  uri: `spotify:track:${id}`,
  name: id,
  artists: [id],
  album: id,
  image: null,
  durationMs,
  pick: 0,
});
const card = (id: string, introMs = 14_000, sure = true): Card => ({
  id,
  name: id,
  artists: [id],
  introMs,
  sure,
  post: "post",
  outro: "fade",
  outroMs: 180_000,
  energy: 3,
  tempo: "mid",
  mood: "",
  notes: [],
  thinking: "",
  enrichedAt: "",
  model: "",
});
const slot = (id: string, intro: RawSlot["intro"], topOfHour = false): RawSlot => ({
  id,
  intro,
  topOfHour,
  why: "",
});

const ids = ["a", "b", "c", "d", "e", "f"];
const records = ids.map((id) => rec(id));
const cards = new Map(ids.map((id) => [id, card(id)]));
/** 8:30 pm: six 200 s records and their breaks end well before the hour. */
const EARLY = (20 * 60 + 30) * 60 * 1000;
/** 8:43 pm: the hour turns after 17 min — with 200 s records that is the 6th slot (seq 5). */
const LATE = (20 * 60 + 43) * 60 * 1000;
const valid = [
  slot("a", "break"),
  slot("b", "talkup"),
  slot("c", "segue"),
  slot("d", "break"),
  slot("e", "sweeper"),
  slot("f", "segue"),
];

describe("checkLog", () => {
  it("passes a valid log untouched", () => {
    const r = checkLog(valid, cards, records, EARLY);
    expect(r.fallbacks).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.log.slots.map((s) => s.intro)).toEqual([
      "break",
      "talkup",
      "segue",
      "break",
      "sweeper",
      "segue",
    ]);
    expect(r.log.slots.map((s) => s.seq)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(r.log.crossesHour).toBe(false);
  });

  it("the first slot is a break", () => {
    const r = checkLog([slot("a", "segue"), ...valid.slice(1)], cards, records, EARLY);
    expect(r.log.slots[0]?.intro).toBe("break");
    expect(r.fallbacks[0]).toMatchObject({ seq: 0, from: "segue", to: "break" });
  });

  it("a talk-up needs a long enough intro (sure or not) and a card", () => {
    const short = new Map(cards);
    short.set("b", card("b", MIN_TALKUP_INTRO_MS - 1));
    short.set("e", card("e", 20_000, false));
    short.delete("f");
    const r = checkLog(
      [...valid.slice(0, 4), slot("e", "talkup"), slot("f", "talkup")],
      short,
      records,
      EARLY,
    );
    expect(r.log.slots[1]?.intro).toBe("segue");
    expect(r.log.slots[4]?.intro).toBe("talkup");
    expect(r.log.slots[5]?.intro).toBe("segue");
    expect(r.fallbacks.map((f) => f.reason)).toEqual([
      `${MIN_TALKUP_INTRO_MS - 1} ms intro is under ${MIN_TALKUP_INTRO_MS} ms`,
      "no card",
    ]);
  });

  it("a break too soon after the last becomes a sweeper; a long gap is a warning", () => {
    const r = checkLog(
      [
        slot("a", "break"),
        slot("b", "break"),
        slot("c", "segue"),
        slot("d", "segue"),
        slot("e", "segue"),
        slot("f", "segue"),
      ],
      cards,
      records,
      EARLY,
    );
    expect(r.log.slots[1]?.intro).toBe("sweeper");
    expect(r.fallbacks[0]).toMatchObject({ seq: 1, from: "break", to: "sweeper" });
    const far = checkLog(
      [
        slot("a", "break"),
        slot("b", "segue"),
        slot("c", "segue"),
        slot("d", "segue"),
        slot("e", "segue"),
        slot("f", "break"),
      ],
      cards,
      records,
      EARLY,
    );
    expect(far.fallbacks).toEqual([]);
    expect(far.warnings).toEqual(["slot 5: 5 songs since the last break"]);
  });

  it("every record exactly once: unknown ids dropped, duplicates dropped, missing appended as segues", () => {
    const r = checkLog(
      [slot("a", "break"), slot("zz", "segue"), slot("a", "segue"), slot("b", "segue")],
      cards,
      records,
      EARLY,
    );
    expect(r.log.slots.map((s) => s.id)).toEqual(["a", "b", "c", "d", "e", "f"]);
    expect(r.log.slots.slice(1).every((s) => s.intro === "segue")).toBe(true);
    expect(r.warnings.length).toBe(6);
  });

  it("the slot where the hour turns is the top-of-the-hour break, whatever the model said", () => {
    const r = checkLog(
      [
        slot("a", "break"),
        slot("b", "talkup"),
        slot("c", "segue"),
        slot("d", "segue"),
        slot("e", "sweeper"),
        slot("f", "segue"),
      ],
      cards,
      records,
      LATE,
    );
    expect(r.log.hourAtSeq).toBe(5);
    expect(r.log.crossesHour).toBe(true);
    expect(r.log.slots[5]).toMatchObject({ intro: "break", topOfHour: true });
    expect(r.fallbacks).toEqual([
      { seq: 5, from: "segue", to: "break", reason: "the hour turns here: legal ID" },
    ]);
    expect(r.log.slots.filter((s) => s.topOfHour).length).toBe(1);
  });

  it("a topOfHour claimed elsewhere is cleared; a break too close before the legal ID gives way", () => {
    // valid has a break at 3; the hour turns at 5 — the legal ID wins, slot 3 becomes a sweeper.
    const r = checkLog([slot("a", "break", true), ...valid.slice(1)], cards, records, LATE);
    expect(r.log.slots[0]?.topOfHour).toBe(false);
    expect(r.log.slots[3]?.intro).toBe("sweeper");
    expect(r.log.slots[5]).toMatchObject({ intro: "break", topOfHour: true });
    expect(r.fallbacks.map((f) => [f.seq, f.to])).toEqual([
      [5, "break"],
      [3, "sweeper"],
    ]);
    expect(r.warnings).toEqual(["slot 0: topOfHour cleared — the hour turns at 5"]);
  });
});

describe("hourAtSeqOf", () => {
  const byId = new Map(records.map((r) => [r.id, r.durationMs]));
  it("returns null when the program ends before the hour", () => {
    expect(hourAtSeqOf(valid.slice(0, 3), byId, LATE)).toBeNull();
    expect(hourAtSeqOf(valid, byId, EARLY)).toBeNull();
  });
  it("counts a break's time on the clock", () => {
    // Five 200 s records = 1000 s; the hour is 1020 s away. Two breaks add 60 s: slot 5 starts past the hour.
    expect(hourAtSeqOf(valid, byId, LATE)).toBe(5);
    expect(
      hourAtSeqOf(
        valid.map((s) => ({ ...s, intro: "segue" })),
        byId,
        LATE,
      ),
    ).toBeNull();
  });
});
