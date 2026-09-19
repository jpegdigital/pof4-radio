# Scheduled news and weather

The preparation workers live in `apps/web/scripts/prep*.mts`. Railway resources live only in
`../pof4-infra/.railway/railway.ts`. They reuse the web workspace's dependencies and run directly
on Node 24; no server, queue, new dependency, Jev call, or voice generation is involved.

| Service | UTC schedule | Content validity |
| --- | --- | --- |
| `radio-news` | `0 */3 * * *` (every three hours) | Up to four hours; each option may expire sooner |
| `radio-weather` | `10,40 * * * *` (every 30 minutes) | Up to one hour; observation must remain under two hours old, forecast under 24 hours |

Both jobs take a per-location Postgres advisory lock, run once, close the pool, and exit. A duplicate
run skips. Errors exit nonzero. The soft deadline is four minutes; a five-minute watchdog bounds a
stuck driver. Railway restart policy is `NEVER`; the next scheduled run is the retry. See
[Railway cron behavior](https://docs.railway.com/cron-jobs).

## Storage and dates

`news_entries` and `weather_entries` retain every successful run. `edition_date` is the job's start
date in `America/Chicago`, including daylight saving. `(place, edition_date, prepared_at)` indexes
support finding the latest run for a date; UUIDs distinguish runs on the same date. Rerunning a
job appends an edition rather than destroying that day's earlier evidence.

Each entry records start, preparation and expiry times. Failed or incomplete pulls publish nothing.
News publication atomically inserts the raw evidence/audit in existing `headline_snapshot` and the
checked options in `news_entries`; its ID links the two. `headline_story` and session exposure rows
remain owned by the existing playback flow. Weather stores normalized data and original NWS JSON
together in one insert. No schema changes happen during worker startup.

News reads `settings.station.news` (the existing Dallas defaults on first install). It reuses the
allowlisted RSS/Atom reader with a larger scheduled fetch budget. KERA, KXT, Dallas City Hall and NPR
provide publisher excerpts; Google feeds remain discovery-only and cannot substantiate facts.
Fresh publisher material is prepared as up to 12 options, with room for Dallas news and cultural
discoveries. Claude extracts facts with exact supporting quotes and separately reviews them.
Rejected options do not publish. A successful review that omits everything publishes an empty edition;
a source/model outage preserves the previous successful edition. This is feed-based research, not
an article-page crawler; short or missing evidence is omitted.

Weather uses [NWS observations, forecasts](https://www.weather.gov/documentation/services-web-api)
and [point alerts](https://www.weather.gov/documentation/services-web-alerts) for northwest Dallas
(75229, Love Field station KDAL, FWD/87,109). Temperatures are °F, observed wind is mph, precipitation
is percent. Observation and forecast times remain separate; forecast periods have absolute start/end
times. Alert failure fails the whole edition instead of publishing a misleading empty alert list.
This first implementation explicitly supports Dallas; changing cities requires configuring both jobs.

## Session contract

`apps/web/src/lib/prepared.ts` exports database-only readers:

```ts
const news = await readPreparedNews(pool(), config, recentArticleRevisions);
const weather = await readPreparedWeather(pool());
// Optional final argument selects a particular YYYY-MM-DD edition date.
```

The readers return the latest saved edition for Dallas (or the requested date), with source timestamps
retained as evidence. There are no session-time expiry checks. Already selected articles are omitted
across revisions. Missing prepared data never triggers request-time research.

Every full break reads these editions under the session lock. `headline-choice.ts` gives Jev the
listener request, up to 12 checked options, and the session's reserved story history. Each option
gets an include/omit/repeat Choice. Code ranks explicit includes by include probability and takes
at most one; zero is valid. It never fills the quota with rejected stories. Exact article/story
IDs are excluded across revisions; Jev checks retitled and syndicated event repeats.

`session_slot.generation` reserves choices before writing, even if Claude fails or playback never
happens. It retains edition IDs and dates, exact Jev requests, answers and probabilities, the music
plan, structured weather, Claude's actual brief/output/usage, and every voice take's text, settings
and bucket key. Returned scripts rejected by slot validation remain in the attempt history with their error. A writer retry keeps the exact saved inputs and choices. A voice
retry keeps the script. Explicit revoicing appends a take; original audio remains available.

The first slot opens with a listener welcome, the DJ's name (when configured), and the requested
show mood before the headlines and weather. Later breaks do not restart the show. This introduction
is part of the same retained script and voice take.

Claude writes selected checked facts, weather and music copy together in one script, followed by
one ElevenLabs call. Missing editions mean omission, never research. Short music slots
keep Jev's existing fixed-ID/context/segue choices and contain no news or weather.

Play always loads the saved voice, bed and track. There is no live preflight, expiry gate,
original-recording toggle, or alternative script. Complete voice reads record the selected story
in `session_news_exposure`; reservations in `generation` prevent repeats regardless of playback.
Every model receipt and voice take remains retained.

## Run and verify

```sh
pnpm db:plan
pnpm db:apply
pnpm prep:news
pnpm prep:weather
op run --env-file=.env.op -- node apps/web/scripts/prep-smoke.mts
# Billed: retains a labeled two-break session; defaults to production web.
op run --env-file=.env.op -- node apps/web/scripts/unified-slot-smoke.mts
```

Add `--dry-run` to either preparation command to perform the real fetch/review without publishing.
News needs `DATABASE_URL`, `CLAUDE_KEY`, `CLAUDE_MODEL`; weather needs only `DATABASE_URL`.
Railway references the existing radio-web Claude variables and the shared database's private address.
Logs contain edition IDs, dates, counts, freshness and source errors, never credentials.

Apply infra from `../pof4-infra` with `pnpm plan` then `pnpm apply`. Both new services build from the
radio repository root and start with `pnpm --filter web prep:news` / `prep:weather`. They have no public
domain or HTTP healthcheck. For a new GitHub-backed service, follow that repository's source-connect
and redeploy instructions, or deploy the current working tree with an explicit project selector:

```sh
railway up --project c750bdd5-4be2-4409-a00e-c266a78f5dae --environment production --service radio-news
railway up --project c750bdd5-4be2-4409-a00e-c266a78f5dae --environment production --service radio-weather
```

Do not omit the project selector from an unlinked checkout: the CLI can create a new project.

## Historical production verification — 2026-09-19

Applied the additive schema and deployed both services into the existing pof4 production project.
An immediate Railway run of each completed successfully and stopped. The news edition contained eight checked options from KXT, KERA News and NPR; weather contained the latest Love Field observation, four forecast periods and zero active alerts. Read-back verification passed date lookup, retained source evidence, used-revision suppression, disabled news, and expired news/weather omission. The infrastructure plan reported no drift. All 385 tests and the web production build passed.

The initial deployments used the local working tree; no git commit or push was made. Future code changes must be deployed or connected to GitHub after the worker code is pushed. Local DNS for the Railway Postgres public proxy was intermittent; verification used its freshly resolved address without changing saved credentials. Railway workers use private networking.

## Unified session verification — 2026-09-19

Applied the additive `session_slot.generation` column and deployed the unified web route to production
(deployment `ab690f96-b53b-45db-a820-7ecb4d55b5b9`). `pnpm check` passed all 384 tests and the web
production build passed. The old request-time editor, weather fetch and alternate voice generation
paths are removed; legacy stored takes remain readable.

The local integration retained session `f71ca92e-537f-439c-834b-1200b7b1929c`, choosing three stories
and then one different story. Hosted session `bf06bdb0-10d9-4ff1-aca4-ac5c79cb8176` chose one story
and omitted remaining headlines on the next break. Both included saved structured weather. The
hosted second break initially exceeded the copy budget; its Jev reservation survived. After tightening
writing guidance, the same break retried successfully without any new Jev calls (11.84 seconds total).
Returned scripts rejected by slot validation now retain their input, output and error in attempt history.

The smoke verified one retained take per break, no reused story IDs, exact model receipts, idempotent
slot requests and all-story exposure acknowledgments. It expired only its own labeled receipt,
verified live playback suppression and byte-identical original audio, then restored the receipt.
No git commit or push was made; deployments used the working tree.

The simplified session path supersedes the historical expiry behavior above: latest saved editions,
at most one unused headline, one saved script/take, and unconditional playback of that production.

## Simplified production verification — 2026-09-19

Deployment `735fcbec-64e1-41ac-8da9-34d5f6a33f45` is live. All 377 tests and the production
build passed. Session `8911c67e-7c3d-4902-9466-0c8d430cf7a4` verified the opening DJ welcome,
one selected headline, prepared weather, no repeated headline at the next full break, retained
model receipts, one take per break, and idempotent retries. A legacy expiry value did not change
returned copy or audio. The Chrome Play show button started the DJ production while the track
remained at 0:00; the test was paused and the browser tab closed afterward.
