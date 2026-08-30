# Data model: the stage files

All files live in `apps/web/public/program/make/` (gitignored). Every file is validated with a zod
schema in `make/shapes.ts` on read and on write; a stage that finds a malformed input fails with
`{ error: "<file>: <zod issue path and message>" }` (FR-005). `id` for a record is the Spotify
track id (the tail of its uri).

## request.json — written by the page, read by discover

```jsonc
{
  "request": "Saturday night 80s, Dallas, hits-forward, keep it warm",
  "station": { "onAir": "56.6, Claude Radio", "calls": "WFAI", "city": "Dallas" },
  "dj": "Marcus",                  // the roster's default voice name, filled by the page
  "startMs": 74580000,             // program clock start, ms since midnight (8:43 pm)
  "count": 12                      // how many records to ask for (10–14)
}
```

## picks.json — written by discover, read by enrich

```jsonc
{
  "rationale": "…why this set, in Claude's words…",
  "picks": [{ "artist": "Duran Duran", "title": "Hungry Like the Wolf", "why": "…" }],
  "records": [                     // resolved, in pick order
    { "id": "…", "uri": "spotify:track:…", "name": "…", "artists": ["…"], "album": "…",
      "image": "https://…", "durationMs": 221000, "pick": 0 }
  ],
  "dropped": [{ "pick": 3, "reason": "no track for …" }]
}
```
Rules: `records.length ≥ MIN_RECORDS (6)` or discover fails; `records` unique by `id`.

## cards/<id>.json — written by enrich (one per record), read by log, script, voice

```jsonc
{
  "id": "…", "name": "…", "artists": ["…"],
  "introMs": 14000, "sure": true,            // instrumental intro; 0 = starts on the vocal
  "post": "In touch with the ground",        // first sung words, "" if none
  "outro": "fade",                           // "cold" | "fade"
  "outroMs": 205000,                         // when the fade starts (≤ durationMs); = durationMs for cold
  "energy": 4,                               // 1–5
  "tempo": "up",                             // "down" | "mid" | "up"
  "mood": "…one line…",
  "notes": ["…", "…"],                       // 2–3 talking points, on-air safe
  "thinking": "…the think-aloud, kept for the operator…",
  "enrichedAt": "2026-08-30T20:12:00Z", "model": "claude-opus-5"
}
```
Rules: a card whose schema fails is deleted and the record dropped from the run. `enrich` writes
`picks.json` back with the newly dropped records moved to `dropped[]`.

## log.json — written by log, read by script and voice

```jsonc
{
  "slots": [
    { "seq": 0, "id": "…", "intro": "break",  "topOfHour": false, "why": "cold open" },
    { "seq": 1, "id": "…", "intro": "talkup", "topOfHour": false, "why": "14 s intro, sure" },
    { "seq": 2, "id": "…", "intro": "segue",  "topOfHour": false, "why": "fade into a hard start" },
    { "seq": 3, "id": "…", "intro": "sweeper","topOfHour": false, "why": "energy jumps 2→4" },
    { "seq": 4, "id": "…", "intro": "break",  "topOfHour": true,  "why": "9:00 — legal ID" }
  ],
  "fallbacks": [{ "seq": 1, "from": "talkup", "to": "segue", "reason": "card not sure" }],
  "crossesHour": true, "hourAtSeq": 4
}
```
Rules (`checkLog()`, `clock-rules.ts`): every record exactly once; `slots[0].intro === "break"`;
`talkup` only if `card.introMs ≥ MIN_TALKUP_INTRO_MS (7000)` (`sure` decides post-landed vs. late in assembly — the live cards are rarely `sure`); breaks at least
`MIN_SONGS_BETWEEN_BREAKS (3)` apart and at most `MAX_SONGS_BETWEEN_BREAKS (4)` apart (soft — a
warning, not a fallback); at most one `topOfHour`, and only at `hourAtSeq` — the first slot whose
computed start time is past the hour boundary (computed from `startMs` + record durations; the
model is told `hourAtSeq`, not asked for it).

## script.json — written by script, read by voice

```jsonc
{
  "lines": [
    { "seq": 0, "legalId": "", "words": "…50–100 words…", "leadLine": "Right now on 56.6 — Duran Duran." },
    { "seq": 1, "words": "Fourteen seconds of Duran Duran — 56.6, Claude Radio." },   // talkup: one field
    { "seq": 3, "words": "Dallas's hit music station. 56.6." },                     // sweeper: one line
    { "seq": 4, "legalId": "WFAI, Dallas.", "words": "…130–180 words…", "leadLine": "Brand new on 56.6 — Janet." }
  ]
}
```
Rules: one line per non-segue slot, none for segues (extras ignored, missing → that slot falls back
to sweeper if a sweeper clip exists, else segue — recorded); `legalId` only on the `topOfHour`
slot; `leadLine` only on breaks.

## program.json — written by voice (via assemble), read by program.tsx

```jsonc
{
  "station": "WFAI, 56.6, Claude Radio", "dj": "Marcus", "voiceId": "…", "startMs": 74580000,
  "elements": [ /* reducer.ts Element[] — the player's input, unchanged shape */ ],
  "notes": [
    { "element": 0, "seq": 0, "treatment": "break", "words": "…", "clip": "slot-0",
      "clipMs": 31200, "bedInMs": 0, "leadMs": 2100 },
    { "element": 2, "seq": 1, "treatment": "talkup", "words": "…", "clip": "slot-1",
      "clipMs": 5100, "atMs": 8500 },
    { "element": 5, "seq": 3, "treatment": "talkup", "words": "…", "clip": "slot-3", "clipMs": 9000,
      "fallback": { "from": "post", "to": "late", "reason": "9000 ms clip over a 7000 ms intro" } }
  ],
  "madeAt": "2026-08-30T20:20:00Z"
}
```
`notes[i].element` indexes `elements`; each element with a clip has one note. Clips are
`make/clips/slot-<seq>.mp3`; the `clipUrl()` helper in `manifest.ts` gains the `make/clips/`
prefix. The bed stays `/program/bed.mp3`; sweeper clips reuse `/program/sweepers/*.mp3` when the
script's sweeper line is empty and a produced sweeper exists.

## House constants (`clock-rules.ts`)

| Constant | Value | Used by |
|----------|-------|---------|
| `MIN_RECORDS` | 6 | discover |
| `MIN_TALKUP_INTRO_MS` | 7000 | log check |
| `MIN_SONGS_BETWEEN_BREAKS` / `MAX_…` | 3 / 4 | log check |
| `BEAT_MS` | 400 | assemble: talk-up ends this long before the post |
| `TALKUP_LATE_MS` | 1500 | assemble: fallback talk-up start |
| `LEAD_FALLBACK_MS` | 0 | assemble: hand-off at clip end when no lead line |
| `ENRICH_CONCURRENCY` | 5 | enrich |

## State transitions

```
request.json ──discover──▶ picks.json ──enrich──▶ cards/*.json (+ picks.json dropped[])
   ──log──▶ log.json ──script──▶ script.json ──voice──▶ clips/*.mp3 + program.json
```
A stage's output overwrites the previous output of that stage only; nothing upstream is touched
(except `enrich` updating `picks.json.dropped`).
