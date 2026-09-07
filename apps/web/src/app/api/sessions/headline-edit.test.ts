import { describe, expect, it } from "vitest";
import { shortlist, validateNews, type NewsDraft } from "./headline-edit";
import type { Article } from "./headlines";

const now = Date.parse("2026-09-06T18:00:00Z");
const a: Article = {
  id: "a",
  title: "Show moves indoors",
  source: "KXT",
  sourceId: "kxt",
  url: "https://kxt.org/show",
  at: "2026-09-06T17:00:00Z",
  scope: "culture",
  evidence: "The venue says Friday's show moves indoors. Existing tickets remain valid.",
  revision: "v1",
  fetchedAt: new Date(now).toISOString(),
};
const draft: NewsDraft = {
  articleId: "a",
  storyId: "new",
  topic: "local music",
  words: "KXT reports that Friday's show is moving indoors, and existing tickets remain valid.",
  claims: [{ text: "Friday's show is moving indoors", quote: "Friday's show moves indoors" }],
  reason: "Useful for local listeners",
  materialChange: false,
  change: "",
  risk: "routine",
  expiresAt: "2026-09-06T18:10:00Z",
};
describe("news eligibility and copy", () => {
  it("excludes title-only discovery and exact revisions already selected", () => {
    expect(
      shortlist(
        [a, { ...a, id: "b", evidence: "" }],
        [
          {
            storyId: "s",
            articleId: "a",
            revision: "v1",
            topic: "music",
            words: "earlier",
            at: a.at,
            heard: false,
          },
        ],
        now,
      ),
    ).toEqual([]);
  });
  it("prefers publisher evidence when Google has the same title", () => {
    expect(shortlist([{ ...a, id: "google", evidence: "" }, a], [], now)).toEqual([a]);
  });
  it.each([
    ["unknown article", { articleId: "missing" }],
    ["unsupported quote", { claims: [{ text: "Tickets are free", quote: "Tickets are free" }] }],
    ["expired", { expiresAt: "2026-09-06T17:00:00Z" }],
    ["no attribution", { words: "Friday's show is moving indoors." }],
    ["high risk", { risk: "review" }],
    ["invented history", { storyId: "made-up" }],
    ["unheard callback", { words: "KXT says, as you heard earlier, the show moves indoors." }],
  ])("rejects %s", (_, change) => {
    expect(validateNews({ ...draft, ...change } as NewsDraft, [a], [], now, 55)).not.toBeNull();
  });
  it("allows a bounded attributed sentence with verbatim evidence", () => {
    expect(validateNews(draft, [a], [], now, 55)).toBeNull();
  });
  it("requires a material change when reusing a story ID", () => {
    const history = [
      {
        storyId: "s",
        articleId: "a",
        revision: "old",
        topic: "music",
        words: "earlier",
        at: a.at,
        heard: false,
      },
    ];
    expect(validateNews({ ...draft, storyId: "s" }, [a], history, now, 55)).toContain("change");
  });
});
