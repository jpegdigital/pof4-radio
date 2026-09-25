# Collected headlines and prepared weather

News collection is deliberately model-free:

```text
HN front page + Dallas publisher feeds → raw edition in Postgres
break → Jev chooses a story, then an optional complementary story
      → Claude writes both into the music/weather script → ElevenLabs voices it
```

## Collection

`apps/web/scripts/prep.mts news` needs only `DATABASE_URL`. It calls no Claude,
Jev, extraction, review or voice API. The default roster is Hacker News, KERA,
KXT and City of Dallas. Saved station source settings still take precedence.

HN uses the official Firebase API: the first 30 IDs from `topstories.json`,
their story records, and up to two top-level comments per story. Original rank,
score, comment count, submission text, linked URL and discussion URLs are kept.
A comment is a community opinion, not verified article content. Linked article
pages are not fetched. HN's submission time is not the linked article's publication
date; an old article can be on the front page today.

Publisher RSS/Atom titles and available excerpts are retained without model editing.
Missing publication times are null; fetching never invents a publication date.
All bounded source responses (RSS XML and HN JSON) are retained in the snapshot.
Collection isolates source failures, logs them, and saves the healthy sources.
A total source outage publishes nothing and leaves the previous edition available.
A successful empty collection is an empty edition.

## Storage

`news_entries.articles` contains strict raw headline records: source title/excerpt,
URLs, timestamps, scope from the configured source, deterministic IDs/revisions,
and optional HN metadata. It has no generated facts, checked-at timestamp,
generated topic or per-story expiry. A database constraint prevents those editorial
fields and requires legacy `options` to be empty whenever `articles` is present.

The linked `headline_snapshot` holds the source responses and normalization result;
its audit is only `{ "version": "raw-news-1" }`. The worker atomically appends both
rows. Legacy `options` and model audits remain unchanged for historical inspection.
New readers select only editions with a non-null `articles` column.

Edition timestamps and the existing four-hour edition expiry are collection metadata,
not editorial judgments. Sessions read the latest saved raw edition, filter disabled
sources and exact article reservations, and give Jev source times and the current
time. There is no session-time network research or automatic re-recording of old shows.

## Selection and presentation

Jev receives the bounded collected menu, source material, the listener's show request,
and reserved story history. Its standing interests are current AI, Dallas/North Texas,
music, science and interesting discoveries. On a scheduled news segment with
eligible stories, at least one headline is required. Disabled news, non-news slots
and exhausted/empty candidate menus skip selection.

The first Choice must select one story; its menu does not include `none`. Only after a story is chosen does a
second Choice see it and choose a distinct complementary story or `none`. Both
requests, answers, probabilities and timing are retained. Code obeys the selected
option; competing probabilities are not treated as independent quality scores.
Already reserved article/story IDs are removed, and Jev compares related events
across publishers/history. A second story must earn its airtime.

Claude receives those raw selections in the existing program-writing call. It writes
roughly one 20-word sentence per selected story, attributed to its source, inside
the overall music/weather word budget. Titles support only modest attributed
mentions; HN submissions/comments remain attributed claims/opinions. No facts are
invented to fill short excerpts. Legacy saved generations retain their original
checked facts when retried. The original scripts and voice takes remain replayable.

## Scheduling and operations

Railway resources belong to `../pof4-infra/.railway/railway.ts`.
News runs every three hours (`0 */3 * * *`); weather runs at minutes 10 and 40.
Both use a per-location advisory lock, a four-minute soft deadline and five-minute
watchdog, then close the pool and exit. Neither runs a server or queue.
The next scheduled invocation is the retry; individual source failures do not
prevent collecting healthy sources.

Weather uses NWS observations, day/night and hourly forecasts, and alerts for Dallas,
ZIP 75229, KDAL, FWD/87,109. The worker retains 48 forecast hours plus source evidence
in the existing JSON weather columns; historical editions without hours still parse.
It is prepared independently and needs only the database URL.

The opening gets fresh observed conditions (or the matching forecast hour when the
observation is too old), plus the current and next day/night periods. Later breaks
get only the forecast hour whose start/end interval contains the server generation
timestamp, with active alerts. This is forecast weather, not a new observation;
Claude phrases it accordingly. No current temperature is interpolated from daily
highs/lows. A missing hour omits routine weather rather than repeating stale facts.
The report and timestamp are retained in generation inputs for retries. Budgets are
roughly 60 words for opening weather, 30 later, with extra room for active alerts.

```sh
pnpm db:plan
pnpm db:apply
pnpm prep:news
pnpm prep:weather
op run --env-file=.env.op -- node apps/web/scripts/prep-smoke.mts
# Billed end-to-end validation: retains a labeled two-break session.
op run --env-file=.env.op -- node apps/web/scripts/unified-slot-smoke.mts
```

`--dry-run` fetches actual sources without publishing. It does not invoke a model.
Apply the additive database change before deploying news and web. For deployments
from an unlinked checkout, always pass the existing pof4 project explicitly:

```sh
railway up --project c750bdd5-4be2-4409-a00e-c266a78f5dae --environment production --service radio-news
railway up --project c750bdd5-4be2-4409-a00e-c266a78f5dae --environment production --service radio-web
```

## Failure diagnosed September 23, 2026

The previous pipeline called Claude for extraction and again for evidence review.
The 18:00 UTC run failed with “News evidence review returned no result”; the
September 24 03:00 UTC run failed parsing an unterminated JSON string. Runs at
21:00 and 00:00 UTC did publish editions. Old logs did not retain the model stop
reason, so token exhaustion could not be confirmed. Removing both worker model
calls removes these failure paths rather than retrying editorial preparation.

## Production verification

On September 23, 2026 (04:50 UTC September 24), the deployed collector ran without
Claude credentials and saved edition `0ad7537f-7ca0-4d6a-80b9-700dd5c80555`: 30 Hacker
News submissions, 12 City of Dallas items, 10 KERA items and 10 KXT items. All four
sources were fresh. Database round-trip, retained source evidence, reservation and
disabled-news checks passed.

The full check passed (526 unit tests and 17 browser tests). Production session
`7482c2d6-c001-43b3-a1ff-b2036faee9b4` exercised two real breaks: Jev selected raw
stories, Claude wrote concise mentions, and each break produced one audio take.
Retries reused retained results, stories did not repeat, and exposure was recorded
for every selected story. This pre-change test allowed a no-news prompt to select zero; the current policy
requires one headline whenever the scheduled news segment has eligible stories.

Hourly weather verification on September 24: hosted edition
`30221716-4aab-4ab9-a8a5-b2c85f05f530` retained 48 hours. Session
`7548ba6c-87a2-4750-bd0e-12616cd8d382` produced a full opening report and a
one-sentence hourly forecast in its later break. Both produced audio, and retries
kept their saved reports and takes. All checks passed: 536 unit tests and 17 browser
tests, plus lint, formatting and types.

Broadcast copy goes straight into the story or weather instead of announcing the
show format. Weather uses connected sentences, with room for a natural opening
report and one or two sentences later. Eleven v3 voices receive expressive, phrase-level inline
emotion and delivery tags from Claude, without a numerical tag limit; other models receive plain speech. Delivery tags are
retained with the script and TTS request and excluded from spoken-word budgets.
