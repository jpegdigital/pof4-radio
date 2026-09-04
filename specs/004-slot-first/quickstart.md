# Quickstart: proving the slot-first show

**Feature**: `004-slot-first` | Contract: [contracts/sessions-api.md](contracts/sessions-api.md) | Model: [data-model.md](data-model.md)

## Prerequisites

- Node via fnm (`.node-version`), `pnpm install` done, 1Password CLI signed in (`op signin`).
- `.env.op` resolves: the Railway Postgres URL, the five `BUCKET_*`, the three `QOBUZ_*`,
  `ANTHROPIC_API_KEY`, `ELEVENLABS_KEY`.
- `/settings` has an identity, at least one voice, and (new) the clock: break every 5, fill 6,
  low water 2.
- `dev.radio.pof4.com` resolves to this machine and the Guard cookie is set (or `GUARD_OPEN`).

## 1. The pure parts — red first, then green

```sh
pnpm test
```

Expected: every `*.test.ts` passes, including the new tables:

| Test | Proves |
|---|---|
| `api/sessions/rules.test.ts` | `isBreak` (1, 1+k, 1+2k…), `legalIdDue` (slot 1; hour change; same hour), `checkSlot` (clock wins; break elsewhere → sweeper; talkup needs ramp ≥ 7 s and sure; no words → segue; clamps) |
| `api/sessions/shapes.test.ts` | `Written` refuses a bad kind, a pick that is not a string, an energy out of 1..5; `numbered` unchanged |
| `api/sessions/fill.test.ts` | `searchQuery` (feat tags stripped); `dedupe` drops a proposal already played or pending, case-insensitive |
| `api/sessions/doc.test.ts` | `statusOf` (proposed/written/voiced); `slotDoc` takes tags from the picked hit, marks `held`, omits `hits`, `thinking`, `clock_ms` |
| `lib/clock.test.ts` | the settings row parses; a missing field or a 0 fails |
| `(app)/sessions/[id]/loop.test.ts` | `nextMove`: no slots → fill; low water → fill once per count; slot 1 before play; slot k+1 once slot k is the cue; nothing beyond one ahead; attempted keys respected |
| `(app)/sessions/[id]/plan.test.ts` | unchanged behaviour with `rampMs` in place of `introMs` |
| `lib/sigv4.test.ts` | `HEAD` signs like `GET` against the AWS vectors |

## 2. The gate

```sh
pnpm check && pnpm --filter web build
```

Expected: lint, format, typecheck, tests and the Next build all green. `pgdelta schema lint`
passes over the four remaining schema files.

## 3. The schema cutover (one time, destructive by design)

```sh
pnpm db:clear            # wipes sessions (cascade) and, this once, the old track rows; bucket bytes stay
pnpm db:plan             # expect: drop card, session_segment, station, segment; recreate session_slot; alter track
pnpm db:apply
pnpm db:sql "select table_name from information_schema.tables where table_schema = 'public' order by 1"
```

Expected: `session`, `session_slot`, `settings`, `track`.

## 4. The bucket and Qobuz, live

```sh
op run --env-file=.env.op -- node apps/web/scripts/bucket-smoke.mts   # now also proves HEAD: present → size, absent → null
op run --env-file=.env.op -- node apps/web/scripts/qobuz-smoke.mts    # search → signed URL → MP3 in the temp dir
```

## 5. First sound after two model calls (User Story 1)

```sh
pnpm dev
```

In the browser at `https://dev.radio.pof4.com:3000`: type an ask (a named record is the strictest
test: "play Dreams by Fleetwood Mac"), pick a voice, go.

Watch the dev terminal. Expected, in order:

```
[session xxxxxxxx] opened: play Dreams by Fleetwood Mac
[session xxxxxxxx] fill: 6 slots added (seq 1–6), 2 dropped         ← model call 1
[session xxxxxxxx] slot 1 written: break, Fleetwood Mac — Dreams (…) ← model call 2
[session xxxxxxxx] slot 1 voiced: break, N chars, M bytes
[session xxxxxxxx] slot 1 track held: Fleetwood Mac — Dreams, M bytes   ← ran alongside the voicing
```

Then press play. Expected: the legal ID dry, the bed up, the break, the record under the lead
line. Exactly two `[claude]` calls before the first sound. Slot 1's row shows `Break`; slots 2–6
show `coming up` with title and artist.

## 6. The show never waits (User Story 2)

Keep listening. Expected while slot 1 plays: `slot 2 written` → `slot 2 voiced` → `slot 2 track
held` in the terminal before slot 1's record ends; the rundown's slot 2 turns from `coming up` into
its kind and the pick's tags. When slot 1 ends, slot 2 goes in with no gap.

By slot 5 (fill 6, low water 2: after slot 4 is written there are 2 unwritten) expect
`fill: 6 slots added (seq 7–12)`. Slot 6 is a break (break every 5 → 1, 6, 11). No title repeats
in the rundown.

Reload the page mid-slot. Expected: no new `written`/`voiced` lines; the rundown lands with the
same statuses; play resumes from the row you pick.

## 7. Concurrency (FR-008, FR-017)

With a session open, in a second terminal:

```sh
curl -s -X POST https://dev.radio.pof4.com:3000/api/sessions/<id>/fill -b "<guard cookie>" &
curl -s -X POST https://dev.radio.pof4.com:3000/api/sessions/<id>/fill -b "<guard cookie>"
```

Expected: one `200 { added: [...] }`, one `409 { "error": "session is already producing" }`.

## 8. The failure paths

- **Voicing fails after the write**: set a bad `ELEVENLABS_KEY`, request the next slot. Expected:
  `502` with `slot.status = "written"`, the row has its pick and words; fix the key, the next pass
  voices it without a second `written` line.
- **Slot not proposed**: `POST …/slots/99 {clockMs: 0}` → `404 … fill first`.
- **Pull of an unwritten slot**: `POST …/slots/6/track` while slot 6 is proposed → `409`.
- **Missing clock**: delete the `clock` row (`/settings` has no delete; use `db:sql` read to
  confirm, then briefly rename the key by hand if you must) → any fill or slot request `500`
  naming `settings row clock`.

## 9. The retired words (User Story 5)

```sh
rg -n -i "record|song|card|candidate|playlist|segment|program" apps/web/src db --glob '!*.test.ts'
```

Expected: hits only in prose that describes what a thing *was* (schema headers, a route comment),
in the `qobuz.ts` parser (Qobuz's own field names), and nowhere as an identifier.

```sh
rg -n "segments/|session_segment|card\b" docs/sessions.html docs/domain.html CLAUDE.md
```

Expected: only in "what goes away" tables and history notes.
