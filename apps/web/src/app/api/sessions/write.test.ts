import { describe, expect, it } from "vitest";
import { clockOf, legalIdOf, produceWrite } from "./write";
import { type WriteInput, writeBrief } from "../../../lib/prompts/write.ts";

/** The brief the writer gets for one slot: what it carries, and what it leaves out. */

const input = (over: Partial<WriteInput> = {}): WriteInput => ({
  prompt: "rainy morning soul",
  dj: "Ada",
  identity: { calls: "WFAI", city: "Dallas", onAir: "56.6, Claude Radio" },
  clock: "7:25 am",
  seq: 3,
  clockSaysBreak: false,
  proposal: { title: "Song C", artist: "Artist C", why: "follows the mood" },
  hit: {
    id: "c1",
    title: "Song C",
    artists: ["Artist C"],
    album: "Album C",
    image: null,
    durationMs: 200_000,
  },
  recent: [
    {
      seq: 1,
      kind: "break",
      words: "Good morning.",
      leadLine: "Here is A.",
      title: "Song A",
      artist: "Artist A",
    },
    { seq: 2, kind: "segue", words: null, leadLine: null, title: "Song B", artist: "Artist B" },
  ],
  played: [
    { title: "Song A", artist: "Artist A" },
    { title: "Song B", artist: "Artist B" },
  ],
  plan: {
    chart: {
      rampMs: 10000,
      sure: false,
      post: "estimated",
      outro: "cold",
      outroMs: 200000,
      energy: 3,
      tempo: "mid",
      mood: "warm",
    },
    kind: "talkup",
    recordUnderMs: null,
    voiceInMs: 1000,
    wordsMax: 12,
    leadWordsMax: 0,
    treatment: "Jev plan",
  },
  legalId: null,
  weather: null,
  headlines: [],
  ...over,
});

describe("writeBrief — the slot", () => {
  it("carries only the fixed recording and explicitly forbids changing it", () => {
    const brief = writeBrief(input());
    expect(brief).toContain("Your direction for this show: rainy morning soul");
    expect(brief).toContain("The clock: 7:25 am");
    expect(brief).toContain("Artist C — Song C");
    expect(brief).toContain("follows the mood");
    expect(brief).toContain("c1 | Song C — Artist C | Album C | 3:20");
    expect(brief).not.toContain("c2");
    expect(brief).toContain("The recording is fixed");
  });

  it("says this slot is the break when the clock says so, and asks for the lead line", () => {
    const brief = writeBrief(input({ clockSaysBreak: true }));
    expect(brief).toMatch(/this slot is the break/i);
    expect(brief).toMatch(/lead line/);
  });

  it("says this slot is not a break otherwise", () => {
    expect(writeBrief(input())).toMatch(/not a break/i);
  });
});

describe("writeBrief — what came before", () => {
  it("carries the last slots' copy in order and everything played", () => {
    const brief = writeBrief(input());
    expect(brief).toContain("Good morning.");
    expect(brief).toContain("Here is A.");
    expect(brief.indexOf("Good morning.")).toBeLessThan(brief.indexOf("Song B"));
    expect(brief).toMatch(/played so far/i);
    expect(brief).toContain("Artist A — Song A");
  });

  it.each(["Ada", null])("opens a new show with a welcome and host identity (%s)", (dj) => {
    const brief = writeBrief(input({ seq: 1, dj, recent: [], played: [], clockSaysBreak: true }));
    expect(brief).toContain("Welcome the listener");
    expect(brief).toContain(dj ? "introduce yourself by name as Ada" : "do not invent a DJ name");
    expect(brief).toContain("before the headlines and weather");
    expect(brief).not.toContain("Skip greetings");
  });

  it("does not restart the show at subsequent breaks", () => {
    const brief = writeBrief(input({ seq: 6, clockSaysBreak: true }));
    expect(brief).toContain("Skip greetings");
    expect(brief).not.toContain("Welcome the listener");
  });

  it("a fresh show says so", () => {
    const brief = writeBrief(input({ seq: 1, recent: [], played: [], clockSaysBreak: true }));
    expect(brief).toMatch(/first slot of the show|nothing has played yet/i);
  });

  it("gives the writer fixed actions and budgets, with no charting assignment", () => {
    const brief = writeBrief(input());
    expect(brief).toContain('"voiceInMs":1000');
    expect(brief).toContain("at most 12 words");
    expect(brief).toContain("Do not revise it");
    expect(brief).not.toContain("Chart the supplied recording");
  });

  it("asks for a complete thought rather than a one-word fragment", () => {
    const base = input();
    const brief = writeBrief({
      ...base,
      plan: {
        ...base.plan,
        kind: "talkup",
        copyStyle: "context",
        talkOverMs: 8000,
        wordsMin: 6,
        wordsMax: 14,
      },
    });
    expect(brief).toContain("approximately 8 seconds");
    expect(brief).toContain("at least 6 words");
    expect(brief).toContain("one useful thought");
    expect(brief).not.toContain("A one-word tag");
  });
  it("returns the complete fixed introduction without a Claude request", async () => {
    const base = input();
    const result = await produceWrite({
      ...base,
      plan: { ...base.plan, copyStyle: "identify", fixedWords: "Panama, Van Halen." },
    });
    expect(result.written).toEqual({ words: "Panama, Van Halen.", leadLine: "" });
  });
});

describe("writeBrief — the legal ID, the weather, the headlines", () => {
  it("gives the weather section current facts without timestamps or source metadata", () => {
    const weather: NonNullable<WriteInput["weather"]> = {
      location: {
        city: "Dallas",
        zip: "75229",
        timeZone: "America/Chicago",
        station: "KDAL",
        grid: "FWD/87,109",
      },
      sources: {
        observation: "https://api.weather.gov/stations/KDAL/observations/latest",
        forecast: "https://api.weather.gov/gridpoints/FWD/87,109/forecast",
        alerts: "https://api.weather.gov/alerts/active?point=32.90,-96.86",
      },
      units: { temperature: "F", wind: "mph", precipitation: "percent" },
      observedAt: "2026-09-19T14:45:00Z",
      forecastUpdatedAt: "2026-09-19T14:00:00Z",
      now: { text: "Clear", tempF: 86, feelsLikeF: null, humidity: 50, windMph: 10 },
      periods: [
        {
          name: "Today",
          isDaytime: true,
          startTime: "2026-09-19T12:00:00Z",
          endTime: "2026-09-20T00:00:00Z",
          tempF: 92,
          short: "Sunny",
          detailed: "Sunny. High near 92.",
          precipitationPercent: 10,
          windSpeed: "5 to 10 mph",
          windDirection: "S",
        },
      ],
      alerts: [
        {
          id: "alert-123",
          event: "Heat Advisory",
          headline: "Heat Advisory for Dallas",
          severity: "Moderate",
          effective: "2026-09-19T12:00:00Z",
          expires: "2026-09-20T00:00:00Z",
          description: "Heat index up to 105 degrees.",
          instruction: "Drink plenty of fluids.",
        },
      ],
    };
    weather.periods.push({
      ...weather.periods[0],
      name: "Tomorrow",
      startTime: "2026-09-20T12:00:00Z",
      endTime: "2026-09-21T00:00:00Z",
    });
    const brief = writeBrief(input({ clockSaysBreak: true, weather }));
    expect(brief).toContain("Weather\nGive a brief weather update.");
    const facts = JSON.parse(brief.split("Give a brief weather update.\n")[1].split("\n")[0]);
    expect(facts).toEqual({
      city: "Dallas",
      current: { text: "Clear", tempF: 86, feelsLikeF: null, windMph: 10 },
      forecast: { name: "Today", tempF: 92, short: "Sunny", precipitationPercent: 10 },
      alerts: [
        {
          event: "Heat Advisory",
          headline: "Heat Advisory for Dallas",
          severity: "Moderate",
          description: "Heat index up to 105 degrees.",
          instruction: "Drink plenty of fluids.",
        },
      ],
    });
    expect(brief).not.toContain("KDAL");
    expect(brief).not.toContain("2026-09-");
    expect(brief).not.toContain("Tomorrow");
    expect(writeBrief(input({ weather }))).not.toContain("Give a brief weather update.");
    weather.periods[0].name = "Tonight";
    weather.periods[0].isDaytime = false;
    expect(writeBrief(input({ clockSaysBreak: true, weather }))).toContain('"name":"Tonight"');
  });

  it("names the legal ID when due and says it is added, not written", () => {
    const brief = writeBrief(input({ clockSaysBreak: true, legalId: "WFAI, Dallas. 56.6, Claude Radio." }));
    expect(brief).toContain('"WFAI, Dallas. 56.6, Claude Radio."');
    expect(brief).toMatch(/do not write it/i);
  });

  it("says no legal ID on a break when not due, and nothing of it on other slots", () => {
    expect(writeBrief(input({ clockSaysBreak: true }))).toMatch(/No legal ID on this break/);
    expect(writeBrief(input())).not.toMatch(/legal ID on this break|said first, dry/);
  });

  it("passes selected checked facts into the single script brief", () => {
    const brief = writeBrief(
      input({
        clockSaysBreak: true,
        headlines: [
          {
            articleId: "a",
            storyId: "story-a",
            revision: "v1",
            title: "Dallas concert",
            topic: "music",
            sourceId: "kxt",
            source: "KXT",
            url: "https://kxt.org/concert",
            scope: "culture",
            publishedAt: "2026-09-19T12:00:00Z",
            fetchedAt: "2026-09-19T13:00:00Z",
            checkedAt: "2026-09-19T13:00:00Z",
            expiresAt: "2026-09-19T18:00:00Z",
            evidence: "The Dallas concert is free.",
            facts: [{ text: "The Dallas concert is free.", quote: "The Dallas concert is free." }],
          },
        ],
      }),
    );
    expect(brief).toContain("The Dallas concert is free.");
    expect(brief).toContain("KXT");
    expect(brief).toContain("The stories you are covering this break");
    expect(brief).not.toContain("news editor");
    expect(brief).not.toContain("inserted before your words");
  });
  it("prohibits researching missing material and inventing news", () => {
    const brief = writeBrief(input({ clockSaysBreak: true }));
    expect(brief).toContain("No headlines selected");
    expect(brief).toContain("No prepared weather");
    expect(brief).toContain("Do not research");
  });
});

describe("clockOf and legalIdOf", () => {
  it.each<[number, string]>([
    [0, "12:00 am"],
    [8 * 3_600_000 + 43 * 60_000, "8:43 am"],
    [12 * 3_600_000, "12:00 pm"],
    [20 * 3_600_000 + 5 * 60_000 + 59_000, "8:05 pm"],
  ])("%i ms → %s", (ms, want) => {
    expect(clockOf(ms)).toBe(want);
  });

  it("the legal ID is the calls, the city, the name on air", () => {
    expect(legalIdOf({ calls: "WFAI", city: "Dallas", onAir: "56.6, Claude Radio" })).toBe(
      "WFAI, Dallas. 56.6, Claude Radio.",
    );
  });
});
