# The program — design

**Date:** 2026-08-29 · **Scope:** a new route group `apps/web/src/app/(program)/` holding everything —
layout, page, reducer, effects hook, UI. Nothing under `(app)` or the server changes. The only imports
from outside the group are the Spotify device (`components/station/use-spotify-device.ts`) and the
account/PKCE module (`components/station/spotify-account.ts`).

## Goal

Practice the *audio shape* of a CHR radio program (the 80s/90s "Energy 101" segment), not its content:
a full break over a bed, a song straight in, talk-ups over the next song's intro with the music ducked,
a dry legal ID, a big top-of-hour break, a power song. Content (weather, headlines, time) is simulated
and pre-generated; the DJ, real data, and persistence come later. The deliverable is a durable
`/program` page and a lane-based state loop we can grow into the station's next format.

## Material (pre-generated, throwaway tooling)

`scripts/program-prep.mjs` (run with `op run --env-file=.env.op -- node scripts/program-prep.mjs`)
writes `apps/web/public/program/` (gitignored): seven ElevenLabs clips in the roster's default voice
and `manifest.json` — station name `WFAI, 56.6, Claude Radio`, DJ name, the five songs and the bed
track as `{uri, name, artists, album, image, durationMs}`, and the clip texts. Clip durations are
measured in the browser (`durationchange`), not stored.

## Model

A **program** is an ordered list of *elements*. Each element says what happens on two lanes:
`music` (the Spotify device — the browser tab) and `mic` (one `<audio>` element).

```ts
type Talk = { clip: string; over: "intro" | "outro" };   // clip = file name in /program
type Element =
  | { kind: "song"; track: Track; talk?: Talk }
  | { kind: "break"; clip: string; bed?: Track; label: string }
  | { kind: "id"; clip: string; label: string };
```

- **song** — `play(uri)`. With an *intro* talk the clip starts in the same instant as `play()`;
  music is held at `DUCK` until the clip ends, then ramps to `FULL` (~500 ms). With an *outro*
  talk the clip is back-timed off the SDK clock: it starts at `duration − clipLength − TAIL`
  (TAIL = 1 s), ducked, and the next element starts when the track ends. A talk is held to its
  clip's length, not a hard 8 s: a long clip keeps the music ducked until it ends.
- **break** — music stopped; with a bed, `play(bed.uri)` at `BED`; the clip plays over it; when the
  clip ends the next element starts (a following song is a fresh `play()` at `FULL` — "straight in").
- **id** — dry: music paused, the clip alone.

Levels: `FULL 0.8` (the station's `USER_VOLUME`), `DUCK 0.3`, `BED 0.25`, `OFF` (paused).

The practice program (from the manifest): `break-small`+bed → Duran Duran (no talk) → Whitney
(intro `talkup-2`) → Tears for Fears (intro `talkup-3`) → Prince (intro `talkup-4`) → `legal-id` →
`break-big`+bed → Janet Jackson (intro `talkup-5`).

## State (`(program)/program/reducer.ts`, pure, tested)

```ts
interface ProgramState {
  loop: "stopped" | "running";
  elements: Element[];
  cursor: number | null;                                  // element on air
  music: { uri: string | null; level: "off" | "bed" | "duck" | "full" };
  mic: string | null;                                     // clip on air
  playSeq: number;                                        // bumps when the element must (re)start
  startedAt: number | null;                               // program clock: wall ms when RUN pressed
  error: string | null;
}
type Event =
  | { type: "RUN" } | { type: "STOP" } | { type: "HALT"; error: string }
  | { type: "CLIP_ENDED"; clip: string } | { type: "CLIP_FAILED"; clip: string }
  | { type: "TRACK_ENDED" }                               // the device ran out of list
  | { type: "OUTRO_DUE" }                                 // the hook's back-timer fired
  | { type: "NEXT" } | { type: "PREV" } | { type: "JUMP"; index: number };
```

The reducer emits the *desired* lane state; it never touches audio. Rules:

- `RUN` at `cursor null` → element 0; otherwise restart the element at the cursor. `startedAt` is set
  once per run so the program clock reads `08:43:00 + (now − startedAt)`.
- Entering a song: `music = {uri, full}`; with an intro talk `music.level = duck`, `mic = clip`.
- `CLIP_ENDED` on a song's intro talk → `mic null`, `level full` (the hook ramps). On a break or id
  → next element. On an outro talk → `mic null` only (the track's end moves the cursor).
- `OUTRO_DUE` on a song with an outro talk → `mic = clip`, `level duck`.
- `TRACK_ENDED` on a song → next element; on a break (the bed ran out — shouldn't) → next element.
- `CLIP_FAILED` → same as `CLIP_ENDED` (a broken voice never stalls the program).
- Past the last element → `loop stopped`, cursor stays.
- `STOP` → `loop stopped`, both lanes `off`/null; cursor kept. `NEXT/PREV/JUMP` move the cursor and
  bump `playSeq`.

## Effects (`(program)/program/use-program.ts`)

One hook, effects keyed on state, mirroring `use-station.ts`'s style:

1. **Clips**: on mount, fetch every clip in the manifest into blob urls and measure durations
   (`durationchange`) — the whole program is known up front, so everything is pre-loaded.
2. **Music lane**: when `playSeq` bumps, `device.play([uri], 0)`; when `music.level` changes,
   `ramp(level)` — a ~500 ms stepped `setVolume` (the SDK has no fade), immediate when going *down*
   (a duck must be instant), ramped when going *up*. `off` → `device.pause()`.
3. **Mic lane**: when `mic` changes to a clip, set `src`, `play()`; `ended` → `CLIP_ENDED`;
   `error`/rejected play → `CLIP_FAILED`.
4. **Outro timer**: when the element on air has an outro talk, arm a timeout from the device's
   clock (`position`/`at` interpolation) for `duration − clipLength − TAIL`; fire `OUTRO_DUE`.
   Re-armed on every playback report (a seek or pause changes the due time).
5. `onTrackListEnded` → `TRACK_ENDED`. `onLost` → `HALT`.
6. iOS unlock: the `<audio>` element plays a silent WAV inside the Run tap (same trick as the station).

## Page (`(program)/layout.tsx`, `(program)/program/page.tsx` + client component)

Its own shell (desktop-wide, a masthead "WFAI 56.6 · Claude Radio"). The page reads
`/program/manifest.json` in the browser and builds the element list. Shows: the program clock,
Spotify connect (reusing the account module), Run/Stop, and the cue sheet as a **timeline** — one row
per element with two lane bars (music: level as colour; mic: the clip and its measured length),
the on-air element highlighted with live position, tap-to-jump.

## Error handling

Device gone or `play()` failing → `HALT` with the message shown. A clip that fails to load or
play is skipped. Leaving the page pauses the device and revokes the blob urls.

## Testing

Reducer: unit tests for every rule above (`reducer.test.ts`). The hook and page are verified live
in the browser with a Premium account (Spotify consent is the user's to grant).

## Out of scope

DJ-generated programs, real weather/headlines/time, the caller/sweepstakes beats, persistence,
Media Session, the station's Guard/identity cookie plumbing beyond what the account module gives.
