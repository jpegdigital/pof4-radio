import { z } from "zod";

export const NEWS_KEY = "station.news";
export type NewsScope = "local" | "nation" | "world" | "culture";
export interface NewsSource {
  id: string;
  name: string;
  url: string;
  scope: NewsScope;
  discoveryOnly?: boolean;
  localOnly?: boolean;
}

/** An explicit fetch allowlist. Settings select IDs, never arbitrary network destinations. */
export const NEWS_SOURCES: readonly NewsSource[] = [
  {
    id: "kera",
    name: "KERA News",
    url: "https://www.keranews.org/news.rss",
    scope: "local",
    localOnly: true,
  },
  { id: "kxt", name: "KXT", url: "https://kxt.org/feed/", scope: "culture", localOnly: true },
  {
    id: "dallas-city",
    name: "City of Dallas",
    url: "https://www.dallascitynews.net/feed/",
    scope: "local",
    localOnly: true,
  },
  { id: "npr", name: "NPR", url: "https://feeds.npr.org/1001/rss.xml", scope: "nation" },
  {
    id: "google-local",
    name: "Google News",
    url: "https://news.google.com/rss/headlines/section/geo/",
    scope: "local",
    discoveryOnly: true,
  },
  {
    id: "google-nation",
    name: "Google News",
    url: "https://news.google.com/rss/headlines/section/topic/NATION?hl=en-US&gl=US&ceid=US:en",
    scope: "nation",
    discoveryOnly: true,
  },
  {
    id: "google-world",
    name: "Google News",
    url: "https://news.google.com/rss/headlines/section/topic/WORLD?hl=en-US&gl=US&ceid=US:en",
    scope: "world",
    discoveryOnly: true,
  },
];

export const NewsConfig = z.object({
  enabled: z.boolean(),
  city: z.string().trim().min(1).max(80),
  region: z.string().trim().min(1).max(40),
  timeZone: z.string().refine((v) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: v });
      return true;
    } catch {
      return false;
    }
  }, "Use an IANA timezone, such as America/Chicago"),
  sources: z
    .array(z.string().refine((id) => NEWS_SOURCES.some((s) => s.id === id), "Unknown source"))
    .max(12)
    .refine((ids) => new Set(ids).size === ids.length, "Duplicate source"),
  refreshMinutes: z.number().int().min(1).max(60),
  cultureRefreshMinutes: z.number().int().min(1).max(120),
  memoryHours: z.number().int().min(1).max(24),
  maxWords: z.number().int().min(20).max(65),
  editTimeoutSeconds: z.number().int().min(10).max(90).default(45),
});
export type NewsConfig = z.infer<typeof NewsConfig>;

/** First-install values; saved settings replace these as a whole. No background activity. */
export const NEWS_DEFAULTS: NewsConfig = {
  enabled: true,
  city: "Dallas",
  region: "TX",
  timeZone: "America/Chicago",
  sources: ["kera", "kxt", "dallas-city", "npr", "google-local", "google-nation", "google-world"],
  refreshMinutes: 5,
  cultureRefreshMinutes: 15,
  memoryHours: 6,
  maxWords: 55,
  editTimeoutSeconds: 45,
};

/** Public receipt: evidence is kept on the server, these fields explain the spoken choice. */
export interface NewsReceipt {
  version?: "prepared-1";
  stories?: { articleId: string; storyId: string; revision: string; title: string; topic: string }[];
  weather?: { entryId: string; observedAt: string; forecastUpdatedAt: string };
  snapshotId: string;
  selectedAt: string;
  checkedAt: string;
  storyId: string | null;
  revision: string | null;
  topic: string;
  words: string | null;
  reason: string;
  sources: { title: string; source: string; url: string; at: string }[];
}
