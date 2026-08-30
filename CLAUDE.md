# Radio

An AI radio station over Spotify: a Claude producer plans an hour of records, writes each segment (a
break over a bed, then 3–5 songs with talk-ups, sweepers and segues), ElevenLabs voices it, and the
browser plays it — clips woven around Spotify tracks played through the Web Playback SDK. The show is
produced **live, one segment ahead**, and everything produced is **kept forever**. The browser is the
state machine; the server is stateless functions. Sibling of `../dreamweaver` and built the same way;
when in doubt, do what dreamweaver does (its `CLAUDE.md` is the fuller philosophy).

## Philosophy — minimize cost, maximize simplicity

- One service (`radio-web`) in the **`pof4`** Railway project, sharing the one Postgres (database
  `radio`) and one bucket (`radio-clips`, for the voice mp3s). No worker, no queue: nothing runs when
  nobody is listening. Infra is not in this repo: `../pof4-infra/.railway/railway.ts` is the
  only place Railway resources are declared — edit there, `pnpm plan` → `pnpm apply` **from that directory**.
  Secrets stay `preserve()`d, set via `railway variables`.
- One database, on purpose: `pnpm dev` talks to the same Railway Postgres (and bucket) as prod over its public proxy.
- Fewest moving parts: route handlers, plain `pg` + SQL (no ORM), declarative schema diffed and applied
  from the dev machine (`pnpm db:plan` / `db:apply`, no migration files).
- **Always minimize dependencies.** Before adding a package, ask whether `fetch`, Web Crypto, the
  platform, or thirty lines of our own would do — that is how `packages/spotify` is plain `fetch` + PKCE
  by hand, and the bucket client is AWS SigV4 by hand (`apps/web/src/lib/sigv4.ts`, tested against the
  AWS vectors) over `fetch` — no Spotify SDK, no AWS SDK, no auth or state-management library in the tree.
  Same rule for services: if the browser can do it (tokens, playback, audio mixing), the server doesn't.
- `packages/*` own pure logic and never read `process.env`; `apps/*` own process/env concerns. That is
  what keeps the producer's rules (`packages/dj`) and the queries unit-testable without Next in the way.
- Private behind Guard (`guard.pof4.com`): one gate, `apps/web/src/proxy.ts` (**temporarily open** —
  `GUARD_OPEN = true` there, so friends can test without a login — only `/settings` still asks for the passkey; flip it back); exempt = `api/health` +
  static, nothing else. No user table. Dev runs at `https://dev.radio.pof4.com:3000` because the cookie is
  bound to `pof4.com` — no localhost bypass.

## How it works (the shape)

**Spotify gives us control, not audio.** The browser tab *is* the playback device (Web Playback SDK,
Premium account required); each visitor plays through their *own* account. Two token flows, kept apart:

- **playback** → the user's token, **browser only**. PKCE needs no secret, so the whole flow lives in
  `components/station/spotify-account.ts`: consent → `/spotify/callback` (a page, not an API route) →
  tokens in localStorage, refreshed in place (one shared in-flight refresh — PKCE rotates the refresh
  token, racing refreshes log you out). No account table, no token route; the server never sees a user
  token. Who is connected (id, name, product — never a token) also goes in a cookie so the page paints the
  name and the Premium gate on first load. Playback is `PUT /me/player/play?device_id=…` from the browser.
- **search** → the app's client-credentials token (needs the secret), used only inside discovery.

**The unit is the segment** (`specs/003-segment-station/`): one break followed by 3–5 songs. A station
row holds the hour's **skeleton** (records in play order, where each segment starts — laid every 3–5 by
`layBreaks`) and its identity; a segment row holds its records, its **lines** (`{seq, treatment, legalId?,
words, leadLine?}`), its **log** (treatments after the clock rules), the player's `Element[]` and a
**note** per clip (words, `clipMs`/`bedInMs`/`leadMs`/`atMs`, any fallback and why) — all four growing
one slot at a time (`log.slots.length` = slots produced; the records past it are still to come) until
the last slot sets `voiced_at`: **complete**, immutable after. A record's **card** (intro length,
`sure`, post — *where* the vocal comes in, never the lyric — ending, energy, talking points) lives in
the `card` table keyed by Spotify track id, shared by every station: the first station to play a
record pays for its card. Cards may be corrected in place; kept segments never re-read them.

**The unit of production is the slot** — one record's card, line and clip — so the first note waits
for one card, one short write and one clip, never for the whole segment. **The server is three calls**
(`contracts/api.md`), each under the station's row lock (a second tab gets 409):

- `POST /api/station/open` — request → station (identity copied from settings) → **discover** the hour
  (one call + Spotify search; a hit counts only when its name is the title *and* its artist is the
  pick's, the shortest such preferred; no such hit → the pick is dropped with why; records already
  played on the station excluded; ≥ 6 resolved or 502) → the first run's records kept as an **open**
  segment: no card, no words, no clip. No other model call.
- `POST /api/station/:id/next` — the same for the segment after the last kept one (409 while that one
  is still producing); the skeleton is re-discovered when it runs short or the request changed; the
  break carries the legal ID when the wall clock crossed an hour since the previous segment was opened
  (`hourTurnedBetween`; the browser sends its own clock as `clockMs`).
- `POST /api/segment/:id/slot/:seq` — one slot end to end, in order, idempotent: the **card** (table
  first; made at medium effort, never quoting a lyric — the post is *where* the vocal comes in; a
  refusal or the API's output filter retried once, then *no card*: the slot is a segue, the record is
  never dropped) → **write** the slot (one call at medium effort: the treatment and every word; the
  brief carries the segment's records with this one marked, the card, everything said on the station
  so far, the legal ID for slot 0 at the top of the hour) → `checkSlot` (slot 0 is the break, a break
  elsewhere is a sweeper, a talk-up needs a card with a ≥ 7 s intro) → the **clip** through ElevenLabs
  `/with-timestamps`, timings at *known character offsets* (`timingsOf`: the bed comes in after the
  legal ID, the lead starts `leadLine.length` from the end), `PUT` to the bucket at
  `stations/<station>/<segment>/<seq>.mp3` → `assembleSlot` (the ladder: post → late → none; lead →
  end; break → sweeper → segue; a null bed = dry) → the row grown; the last slot completes it,
  immutable after. A failed clip is a fallback, never an error. `GET /api/clip/:segmentId/:seq`
  streams a clip back, immutable.

Orchestration is `apps/web/src/lib/producer/` (reads env, db, the bucket, Claude, Spotify, ElevenLabs;
`segment.ts` opens, `slot.ts` produces); the pure parts — shapes, `clock-rules`, `timings`, `assemble`,
the prompt slots and tool schemas — are `packages/dj/src/program/`, all tested. `GET /api/station/:id`
returns a kept station whole.

**The loop lives in the browser** (`apps/web/src/components/station/`): the three-lane reducer
(`reducer.ts`, tested) and one effects hook (`use-program.ts`). Lanes: `music` is the Spotify device
(songs only; the one knob is volume, stepped from a timer), `mic` is the voice `<audio>` element and
`bed` a looping buffer, both in one Web Audio graph — the bed's gain is scheduled on the audio clock
so it lands exactly. One cursor walks the `Element[]`; `segments[]` maps index ranges back to kept
segments (the rundown groups by it) — the last one grows as slots land (`SEGMENT_OPENED`, then a
`SEGMENT_SLOT` per slot). **Produce as you go:** Run on a fresh page calls `open` (the records paint at
once), then slot 0 — the break — and plays it the moment its clip is fetched (`voice-cache.ts`, one
object URL per clip URL for the life of the page); the remaining slots land one by one under the music;
as the segment's last element goes on air, `next` opens the segment after it and its slots follow. A
record whose slot hasn't landed when it is due plays as a clean segue (its late clip is kept, not
played); a fresh show waits in silence for its opening break instead. A failed request or a 409 is
retried on the next element. Stop keeps the cursor; a page load is a fresh show unless a past station
is picked from "Resume a show" — every kept segment loads at once (`LOAD_SHOW`), nothing is re-made,
and Run finishes an unfinished segment and produces the next one. The rundown (`rundown.tsx`) is the
show as produced — a row per element with its treatment, the on-air marker, and behind a chevron the
words, timings, card facts and fallback badge; the records still to come in the dim tone; the ask
where it changes — read-only. `use-media-session.ts` mirrors the player onto the lock screen.

**The prompts are settings.** Four slots — `prompt.system`, `prompt.discover` (`{request}`, `{dj}`,
`{identity}`, `{clock}`, `{played}`), `prompt.card` (`{record}`), `prompt.write` — one slot's brief —
(`{request}`, `{dj}`, `{identity}`, `{clock}`, `{slot}`, `{records}`, `{cards}`, `{previous_words}`,
`{legal_id}`) — plus
`station.identity` (`{calls, city, onAir}`), all `settings` rows edited on `/settings`. **The text lives
only in the table** — no copy or fallback in code (`PROMPT_SLOTS`, `fillVars` in
`packages/dj/src/program/prompt.ts`); the rules of the clock (`RULES_TEXT`) and the three tool schemas
stay in code and are appended per call. `loadPromptTemplate()` / `loadIdentity()` read the rows per
request and throw if one is missing. A fresh database needs the four prompt rows, the identity row and
a `voices` row (the roster: `[{id, name, gender, modelId, stability, similarityBoost, style, speed,
speakerBoost}]`, first is the default; a station is voiced in the voice picked when it was opened).
No provenance yet: a station doesn't record which prompt text produced it.

**Three shells, route groups.** `app/(app)` is the station, phone-wide; `app/(settings)` is the control
room, desktop-wide (prompts, identity, voices); `app/(winamp)` is the same station wearing a Winamp skin.
The root layout holds only fonts and the ground colour.

**`app/(program)` is a sandbox, kept only to lift from.** It is the hand-run, file-based maker the
segment station was cut from (`program/make/` — five stages writing under `public/program/make/`,
gitignored; dev only, 404 in production) and its own player. **Nothing on the home path imports it**
(`grep -rn "(program)" apps/web/src | grep -v "app/(program)/"` must stay empty) — it is deletable as a
folder and the home page builds without it. Its prompts live in `make/prompts.ts`, its bed and sweepers
under `public/program/`; the home page's are `public/bed.mp3` and `public/sweepers/*.mp3`, copied in by
hand (`scripts/sweepers-prep.mjs` produces sweepers).

## Working here

- Line endings are LF everywhere, in the repo and the working tree, on every machine: `.gitattributes`
  (`* text=auto eol=lf`) overrides any local `core.autocrlf`; `.editorconfig` and Biome (`lineEnding: lf`)
  write the same. If a fresh clone shows phantom "modified" files, `git add --renormalize .` once.
- Node via fnm (`.node-version`), pnpm workspaces. `pnpm check` (= lint + format:check + typecheck + test)
  then `pnpm --filter web build` is the pre-push gate; CI runs the same.
- Tests: pure logic only (`*.test.ts` next to the code: the reducer, the shapes, the clock rules, the
  timings, the assembly ladder, the SigV4 signer against the AWS vectors). Anything needing Postgres,
  Spotify, Claude, ElevenLabs or the bucket is verified live (`specs/*/quickstart.md`;
  `apps/web/scripts/bucket-smoke.mts` proves the signer against the real bucket).
- Env for local dev comes from 1Password via `op run --env-file=.env.op` (see that file for the vault
  items; the five `BUCKET_*` come from `pof4-radio-clips-bucket`).
- Spotify app: registered at developer.spotify.com; the redirect URIs (dev + prod) must be listed there
  exactly. The Recommendations / Audio Features endpoints are unavailable to new apps — the producer
  picks, Spotify resolves.
