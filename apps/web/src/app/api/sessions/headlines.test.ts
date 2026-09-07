import { describe, expect, it } from "vitest";
import { parseFeed } from "./headlines";

const parseGoogle = (xml: string, take: number) =>
  parseFeed(xml, { id: "google", name: "", url: "", scope: "local", discoveryOnly: true }, Date.now())
    .slice(0, take)
    .map(({ title, source, at }) => ({ title, source, at }));

/** A Google News RSS feed as it ships: `Headline - Source` titles, a <source> element, entities. */
const item = (title: string, source: string, at = "Thu, 03 Sep 2026 11:14:44 GMT") =>
  `<item><title>${title}</title><link>https://news.google.com/rss/articles/x?oc=5</link><guid isPermaLink="false">x</guid><pubDate>${at}</pubDate><description>&lt;a href="x"&gt;${title}&lt;/a&gt;</description><source url="https://example.com">${source}</source></item>`;
const feed = (items: string[]) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><rss version="2.0"><channel><title>Dallas - Latest - Google News</title>${items.join("")}</channel></rss>`;

describe("Google discovery feed", () => {
  it("reads the top items in feed order, the source stripped from the title and kept beside it", () => {
    const xml = feed([
      item(
        "Grass fires burn along highways in Dallas and Denton counties - FOX 4 News Dallas-Fort Worth",
        "FOX 4 News Dallas-Fort Worth",
      ),
      item(
        "Lamster: 10 films that capture the strange soul of Dallas - Dallas News",
        "Dallas News",
        "Wed, 02 Sep 2026 10:11:25 GMT",
      ),
      item("Third - Reuters", "Reuters"),
      item("Fourth - Reuters", "Reuters"),
    ]);
    expect(parseGoogle(xml, 3)).toEqual([
      {
        title: "Grass fires burn along highways in Dallas and Denton counties",
        source: "FOX 4 News Dallas-Fort Worth",
        at: "2026-09-03T11:14:44.000Z",
      },
      {
        title: "Lamster: 10 films that capture the strange soul of Dallas",
        source: "Dallas News",
        at: "2026-09-02T10:11:25.000Z",
      },
      { title: "Third", source: "Reuters", at: "2026-09-03T11:14:44.000Z" },
    ]);
  });
  it.each([
    [
      "entities in a title are decoded",
      item("Tom &amp; Jerry: &#39;a classic&#39; &quot;returns&quot; - AP News", "AP News"),
      { title: "Tom & Jerry: 'a classic' \"returns\"", source: "AP News" },
    ],
    [
      "a title with its own dash keeps it; only the source suffix goes",
      item(
        "Dallas-Fort Worth braces for heat - and storms - NBC 5 Dallas-Fort Worth",
        "NBC 5 Dallas-Fort Worth",
      ),
      { title: "Dallas-Fort Worth braces for heat - and storms", source: "NBC 5 Dallas-Fort Worth" },
    ],
    [
      "a title that does not end in its source is kept whole",
      item("Just a headline", "Reuters"),
      { title: "Just a headline", source: "Reuters" },
    ],
    [
      "no source element: the source is read off the title's last dash",
      "<item><title>A headline - The Verge</title><pubDate>Thu, 03 Sep 2026 11:14:44 GMT</pubDate></item>",
      { title: "A headline", source: "The Verge" },
    ],
  ])("%s", (_, it_, want) => {
    expect(parseGoogle(feed([it_]), 3)[0]).toMatchObject(want);
  });
  it("an empty channel is no headlines", () => {
    expect(parseGoogle(feed([]), 3)).toEqual([]);
  });
  it("a body that is not an RSS feed is refused, loudly", () => {
    expect(() => parseGoogle("<html><body>Before you continue to Google</body></html>", 3)).toThrow(
      /not an RSS feed/,
    );
  });
});
