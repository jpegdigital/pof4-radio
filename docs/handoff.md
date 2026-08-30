# Radio — build handoff

*How to build an AI radio station over Spotify from scratch. Written for an agent (with a human steering)
that will make its own implementation choices on Supabase + Railway. This is the architecture, the reasons,
the traps, and the contracts — not the source.*

---

## 1. What it is, in one breath

A listener types a mood. A Claude DJ plans a **segment**: one piece of spoken talk (an opening on the first
segment, a bridge from the previous block after that) plus **3–4 real Spotify tracks** it found by searching.
ElevenLabs voices the talk. The browser plays it all — the voice clip through an `<audio>` element, the
tracks through Spotify's Web Playback SDK (the browser tab *is* the Spotify device). While a block plays, the
DJ is already planning the next one. It goes on for as long as someone listens.

Stack as built: Next.js (App Router, route handlers), React 19, plain `pg` + SQL, `@anthropic-ai/sdk`,
ElevenLabs streaming TTS, Spotify Web API + Web Playback SDK, Tailwind, Vitest, pnpm workspaces.

## 2. The three ideas that make it work

Everything else is detail. If you keep these, the app will work; if you drop one, you'll fight it.

### 2.1 The browser is the state machine; the server is stateless functions

Nothing runs when nobody is listening. There is no worker, no queue, no scheduler, no websocket. The server
exposes exactly two real functions — *plan the next segment* and *voice this text* — and a couple of reads.
The browser holds the show, the cursor, the loop, the audio, the Spotify device, and decides when to call
the server. A closed tab is a stopped station; nothing leaks.

Consequences you get for free: one cheap service, no orchestration bugs, trivially resumable (the DB holds
the conversation, the browser holds the position), and the whole playback logic is a pure reducer you can
unit-test without any I/O.

### 2.2 Spotify gives you control, not audio

You never get Spotify's audio bytes. Instead the browser registers itself as a Spotify Connect device
(Web Playback SDK, **Premium account required**) and you tell Spotify "play these URIs on that device" via
`PUT /me/player/play?device_id=…`. Playback state comes back through the SDK's `player_state_changed`.
Your own audio (the DJ's voice) plays through a normal `<audio>` element you control. The "radio" is the
interleaving of those two sources: pause/duck Spotify → play voice → on `ended`, start the block.

### 2.3 The DJ is one long conversation per station, kept cheap

Each station is a single Claude conversation stored as `messages` JSON on a row. Every segment is one more
user turn ("here's the request, here's what you just played, program the next block") that the DJ answers
by calling tools: `search_spotify` as many times as it likes, then `finish_segment` once. Three things keep
it cheap and coherent over hours:

- **Trim each finished turn** down to three messages (request → the accepted `finish_segment` call → its
  result). The searches and their result listings are thrown away once the decision is made. The DJ still
  sees exactly what it said and played in every earlier segment.
- **Cap history** at the last 20 segments (60 messages).
- **Prompt-cache** with a 1-hour TTL: one breakpoint on the system prompt, one on the last message.
  Segments are ~15 minutes apart, so the default 5-minute cache would miss every time.

## 3. Architecture

```
┌──────────────────────────── browser (the state machine) ────────────────────────────┐
│  reducer (pure)  ←events─  effects hook  ─→  <audio> (talk)   Spotify SDK (device)  │
│      │                          │                                    ▲              │
│  cursor {seg,item}         fetch talk audio                   PUT /me/player/play   │
│  segments[≤20]             ask for next segment              (user's PKCE token,    │
│                                                               lives in localStorage)│
└───────────────┬──────────────────────┬──────────────────────────────────────────────┘
                │ POST /api/station/next│ GET /api/tts?text&voiceId
                ▼                      ▼
┌──────────────────── Railway: one Next.js service (stateless) ───────────────────────┐
│  /api/station/next: lock station row → build user turn from prompt templates        │
│      → Claude tool loop (search_spotify via app token, finish_segment)               │
│      → validate ids → trim + cap messages → insert segment → commit                  │
│  /api/tts: look up voice in roster → stream ElevenLabs → pipe to browser            │
│  /api/station/:id, page loader: reads                                                │
└──────────────┬────────────────────────────────┬─────────────────────┬───────────────┘
               ▼                                ▼                     ▼
      Supabase Postgres                  Anthropic API           ElevenLabs API
   station · segment · settings                                 Spotify Web API (search)
```

**Token flows, kept apart on purpose:**

| Purpose | Token | Where it lives | How |
|---|---|---|---|
| Playback (SDK, `/me/player/*`) | The listener's user token | **Browser only**, localStorage, refreshed in place | Authorization Code + **PKCE** — no secret, so the browser runs the whole flow. Scopes: `streaming user-read-email user-read-private user-read-playback-state user-modify-playback-state` |
| Search (inside the DJ loop) | App token | Server process memory | Client Credentials with the client secret |

Every visitor plays through their *own* Premium account; the server never sees a user token. (Spotify apps
in Development mode must list each tester's account under User Management.)

### 3.1 Repo shape

```
apps/web            Next.js: the gate, the station page, /settings, the API routes. Owns process.env.
packages/dj         The DJ: prompt assembly, tool schemas, the Claude loop, trimming/caching. Pure, tested.
packages/spotify    Spotify auth (client-credentials + PKCE helpers) and API calls. Pure fetch + Web Crypto.
packages/db         Declarative schema (schema/*.sql) + typed query functions over pg.
```

The rule: `packages/*` never read `process.env` and never import Next. That split is what makes the DJ
and the reducer unit-testable, and it costs nothing. One app, but keep the split.

**Always minimize dependencies.** The runtime tree is Next/React, `pg`, `@anthropic-ai/sdk`, `zod`, an
icon set, and Tailwind — that's it. Spotify auth is `fetch` + Web Crypto (PKCE by hand, ~80 lines), not
an SDK or an auth library; playback is the SDK script Spotify serves plus one `PUT`; state is a `useReducer`;
TTS is a `fetch` piped through. Before adding a package, ask whether the platform or thirty lines of your
own would do. The same rule applies to services: if the browser can do it (tokens, playback, audio), the
server doesn't.

## 4. Data model

Three tables. No user table (auth is a gate in front, not a concept inside). No status columns — the
browser is the state machine, so a row exists only once a thing is done.

```sql
-- One listener's show and the DJ's memory of it.
create table station (
  id            uuid primary key default gen_random_uuid(),
  prompt        text not null,                 -- the listener's current ask
  messages      jsonb not null default '[]',   -- the Claude conversation, already trimmed + capped
  segment_count integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Append-only log: one row per segment the DJ finished.
create table segment (
  id          uuid primary key default gen_random_uuid(),
  station_id  uuid not null references station (id) on delete cascade,
  seq         integer not null,               -- 1-based within the station
  prompt      text not null,                  -- the ask in force when planned
  talk        text not null,                  -- the one spoken piece
  tracks      jsonb not null,                 -- [{id, uri, name, artists[], album, durationMs}]
  model       text not null,
  created_at  timestamptz not null default now(),
  unique (station_id, seq)
);
create index on segment (station_id, seq desc);

-- What /settings edits and the server reads per request. Prompt text and the voice roster live ONLY here.
create table settings (
  key         text primary key,   -- prompt.system | prompt.opening | prompt.bridge | prompt.shift | voices
  value       text not null,
  updated_at  timestamptz not null default now()
);
```

`segment.tracks` is denormalised on purpose: it's exactly what the player needs, no joins, no track table.

## 5. The server: two functions

### 5.1 `POST /api/station/next` — plan the next segment

Request `{ stationId: uuid | null, prompt: string (1–500), dj?: string }`. `stationId: null` creates a
station. Response `{ stationId, segment: { id, seq, prompt, talk, tracks[] } }`. Typical latency 20–60 s;
the client uses no timeout shorter than 120 s.

The shape of the handler:

1. Create the station if needed. Take the row lock: `select … from station where id = $1 for update
   skip locked` inside a transaction. No row back but the station exists → **409 busy** (a second tab
   pressed Run; it must not start a second billed run). Hold the lock for the whole plan.
2. Load the last segment and the four prompt slots from `settings`. Build the user turn (§7).
3. Run the DJ loop (§6) with `history = station.messages`.
4. `messages = capHistory([...history, ...trimTurn(turn)])`.
5. In the same transaction: insert the `segment` row (`seq = segment_count + 1`), update
   `station.prompt/messages/segment_count`. Commit. Always release in a `finally`.
6. Log usage per segment (`input / cache_read / cache_write / output`, request count) — it's how you'll know
   the cache is working.

Errors: 400 invalid body · 404 unknown station · 409 busy · 502 with the DJ's failure message (refusal,
turn cap, no tracks). The browser retries a 502 once, then halts with the error.

### 5.2 `GET /api/tts?text=&voiceId=` — voice a line

The browser names a voice by id; the server looks it up in the roster (`settings.voices`), builds the
ElevenLabs body from that voice's model + settings, and pipes the streaming response straight through:

```ts
const upstream = await fetch(
  `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream?output_format=mp3_44100_128`,
  { method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({ text, model_id, voice_settings: { stability, similarity_boost, style, speed, use_speaker_boost } }) });
return new Response(upstream.body, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
```

No storage, no bucket. The browser fetches the clip as a Blob and holds it. Only `ELEVENLABS_KEY` lives on
the server; the tuning is data in the DB, so a voice tweak reaches the next line without a redeploy.

### 5.3 Reads

`GET /api/station/:id` → `{ stationId, prompt, segmentCount, segments: [last 20] }` for resuming a past
show. The station page's server component also loads the voice roster (ids + names only, never the
tuning) and the list of recent stations, so the page paints whole on first load.

## 6. The DJ loop (`packages/dj`)

Two tools, frozen in code (their schema is what the validator checks):

```ts
{ name: "search_spotify", strict: true,
  description: "Search Spotify's catalog for tracks. Supports Spotify search syntax, e.g. 'artist:Khruangbin', 'year:1971-1975 genre:soul'. Returns up to `limit` tracks with ids, artists, album, year, duration.",
  input_schema: { type: "object", properties: { query: {type:"string"}, limit: {type:"integer", description:"1 to 20. Use 8 unless you need more."} }, required: ["query","limit"], additionalProperties: false } }

{ name: "finish_segment", strict: true,
  description: "Deliver the finished segment. Every id in track_ids must have come back from a search_spotify call in this conversation.",
  input_schema: { type: "object", properties: { talk: {type:"string"}, track_ids: {type:"array", items:{type:"string"}, description:"Spotify track ids in play order, 3 to 4 of them."} }, required: ["talk","track_ids"], additionalProperties: false } }
```

The loop is manual (no helper), and this is the part to get exactly right:

```ts
async function planSegment({ system, history, userTurn }, { client, model, search }) {
  const seen = new Map<string, Track>();          // every track any search returned this turn
  const turn = [{ role: "user", content: userTurn }];
  for (let i = 0; i < 12; i++) {                  // runaway guard, not a budget
    const res = await client.messages.create({
      model, max_tokens: 4096,
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral", ttl: "1h" } }],
      tools: TOOLS,
      messages: withCache([...history, ...turn]), // one 1h breakpoint on the last block of the last message
    });
    if (res.stop_reason === "refusal" || res.stop_reason === "max_tokens") throw …;
    turn.push({ role: "assistant", content: res.content });
    const uses = res.content.filter(b => b.type === "tool_use");
    if (!uses.length) { turn.push({ role:"user", content:"Use the tools: search, then finish_segment." }); continue; }

    const results = []; let finished = null;
    for (const use of uses) {
      if (use.name === "search_spotify") {
        const tracks = await search(use.input.query, use.input.limit);
        for (const t of tracks) seen.set(t.id, t);
        results.push({ type:"tool_result", tool_use_id: use.id,
                       content: tracks.map(describeTrack).join("\n") || "No results." });
      } else if (use.name === "finish_segment") {
        const check = resolveFinish(use.input, seen);   // ids ⊆ seen, 3–4 of them, no dupes, talk non-empty
        if (check.ok) { finished = {...}; results.push({ …, content: "Segment accepted." }); }
        else results.push({ …, is_error: true, content: check.error });  // the DJ tries again
      }
    }
    // With 3 calls left, append a text block: "Call finish_segment now with 3 or 4 tracks you have seen."
    turn.push({ role: "user", content: results });
    if (finished) return { ...finished, turn, usage };
  }
  throw new Error("the DJ did not finish within 12 turns");
}
```

Key details:

- **The DJ can only play what it searched.** `resolveFinish` rejects any id not in `seen` with a tool
  error naming the offending ids; Claude corrects itself on the next turn. This single check is what makes
  "never invent a track" true rather than hoped-for. Spotify's Recommendations/Audio Features endpoints are
  closed to new apps — the DJ picks, Spotify resolves.
- `describeTrack` gives the model one line per hit: `Artists — Name [Album (year), 252s] id=…`. Duration
  and year matter to a DJ.
- Tracks are resolved from `seen` server-side (name, uri, artists, album, durationMs) — the model returns
  ids only.

### 6.1 Trimming, capping, caching (`history.ts`)

```ts
// After a segment is accepted, the whole turn becomes three messages:
trimTurn(turn) => [
  { role: "user",      content: <the request text> },
  { role: "assistant", content: [{ type:"tool_use", id, name:"finish_segment", input }] },
  { role: "user",      content: [{ type:"tool_result", tool_use_id: id, content:"Segment accepted." }] },
]
capHistory(messages, 20)   // keep the last 20×3, dropping whole turns from the front
withCache(messages)        // strip any old cache_control, put one {ephemeral, ttl:"1h"} on the last block of the last message
```

Verify it live: `select jsonb_array_length(messages), segment_count from station` should give ≈ 3×count,
never above 60; `cache_read_input_tokens > 0` from the second segment on.

## 7. Prompts are data

Four slots in `settings`, placeholders `{request}`, `{previous_talk}`, `{previous_tracks}`, `{dj}`. Code
knows the slot names and which placeholders each may use; **no prompt text in code, no fallback** — a
missing slot throws. Edit on a `/settings` page (or in the table). Editing the system prompt costs one
cache miss, nothing more.

Assembly per segment:

```
opening  (first segment)  = fill(prompt.opening)
bridge   (later)          = fill(prompt.bridge) + (request changed since last segment ? "\n" + fill(prompt.shift) : "")
```

`{dj}` is the picked voice's *name*, sent by the browser with each request and baked into the **user turn**
("On the mic: …"), never into the system prompt — so switching DJ mid-show is a handoff on air, not a cache
miss.

The text that works today (start here, then tune):

**prompt.system**
```
You are the on-air host of Claude Radio — a small personal station with one listener, listening right now,
who told you what they're in the mood for. Each segment's brief names who's on the mic; that's you for that
segment, and you speak as them. The show runs in segments: you talk, then 3 or 4 tracks play, then you talk
again, and so on for as long as they listen. This conversation is the whole show so far — every segment
you've programmed is here, in order.

Each segment has exactly one piece of talk:
- On the first segment it's an opening: the station ident and your name, the way a real host signs on
  ("You're listening to Claude Radio, I'm DJ so-and-so" — in your own words), then set the mood and lead
  into the first track.
- On every later segment it's a bridge: close the block that just played (name a song or two, say something
  true and specific — a year, a place, a detail about the record) and lead into the first track of the new
  block. The listener may have skipped through some of the previous block, so refer to it the way a host
  would — "that was…", "we had…" — without insisting they heard every second of it. Every few bridges, not
  every one, drop a station ident — "this is Claude Radio", "you're on Claude Radio with <your name>" — the
  classic way, in passing.
- Hosts change sometimes. When the brief names a different host than the previous segment's brief did, that
  bridge is a handoff: you're the new host picking up the mic — give the outgoing host a nod, say who you
  are, and carry the show on without missing a beat. Otherwise there's no need to keep repeating your name.

How you program:
- Use search_spotify to find real tracks. Search as often as you need (artists, eras, moods, exact titles)
  — only tracks that came back from a search can go in a segment. Never invent an id.
- Pick for flow: an arc across the 3–4 tracks and a link from the previous block. Don't repeat anything
  from earlier segments, and don't repeat an artist within a segment unless the listener asked for that artist.
- If the listener's request changes, acknowledge the shift on air and follow it.

How you talk:
- It's spoken, not read. A warm, unhurried late-night host: short sentences, contractions, no lists, no
  markdown, no emoji, nothing a voice can't say. Keep it tight: 3 short sentences, 60 to 70 words, never
  more; a couple of details, not three.
- You may use at most two bracketed delivery tags where it genuinely helps, like [sighs] or [laughs].

When the segment is ready, call finish_segment exactly once and write nothing after it.
```

**prompt.opening**
```
Listener's request: {request}
On the mic: {dj}

This is the first segment of the show. Sign on, open the show and program the first block.
```

**prompt.bridge**
```
Listener's request: {request}
On the mic: {dj}

The previous segment (your talk and its tracks):
{previous_talk}
{previous_tracks}

Program the next segment. Your talk is the bridge: close the previous block and open this one. The listener
may have skipped some of it — write so it reads naturally either way.
```

**prompt.shift**
```
The listener changed the mood to: {request}. Acknowledge the shift on air and follow it.
```

## 8. Voices are data

`settings.voices` is a JSON array; order is picker order, first is the default:

```json
[{ "id": "<elevenlabs voice id>", "name": "Vera", "gender": "female",
   "modelId": "eleven_v3", "stability": 0.5, "similarityBoost": 0.75, "style": 0, "speed": 1, "speakerBoost": true }]
```

Measured facts about the models: `eleven_v3` is the expressive one, reads `[audio tags]` in the talk,
stability is a *mode* (only 0 / 0.5 / 1 are accepted), and it **ignores** `speed` and `style`.
`eleven_multilingual_v2` is steadier and cheaper, continuous knobs, `speed` works, ignores tags. The
`/settings` page edits the roster with a "preview this unsaved form" button (same TTS function, voice
passed in rather than looked up). The station page gets `{id, name, gender}` only.

## 9. The browser: the reducer and the effects

### 9.1 The show is a list of metatracks; one cursor walks it

A segment is a *metatrack*: item 0 is its talk, items 1..n its tracks. The whole show is
`segments[]` (oldest first, capped at 20) and one `cursor {seg, item}`. One transport
(prev · play/pause · next) moves the cursor through talk and tracks alike; the show is rendered as a
tappable cue sheet where any row jumps to it. "Skip the talk" is just *next*.

```ts
interface StationState {
  loop: "stopped" | "running";        // Run/Stop. Absolute. Stop keeps the cursor and the DJ's memory.
  phase: "idle" | "planning" | "playing";
  segments: SegmentView[];            // {id, seq, prompt, talk, tracks[]}
  cursor: { seg: number; item: number } | null;
  pending: boolean; requestSeq: number; retried: boolean;   // one /next in flight at most; one retry
  playSeq: number;                    // bumps whenever the item under the cursor must (re)start
  error: string | null;
}
```

Events: `RUN` `STOP` `HALT{error}` `LOAD_SHOW{segments}` `CLEAR_SHOW` `SEGMENT_READY{segment}`
`SEGMENT_FAILED{error}` `TALK_FAILED{segmentId}` `ENDED` `TRACK_CHANGED{uri}` `NEXT` `PREV`
`JUMP{seg,item}` `CLEAR_ERROR`.

The one rule that makes "one segment ahead" fall out of the state: **planning is requested in exactly one
place** — whenever the cursor lands on a *talk* and that segment is the *tail* (plus RUN with nothing in the
list). So the DJ is asked the moment the last block's talk starts, the answer lands 20–60 s later while the
block is still playing, and rewinding never plans.

```ts
function moveTo(s, cursor) {
  const moved = { ...s, phase: "playing", cursor, playSeq: s.playSeq + 1 };
  const plans = s.loop === "running" && cursor.item === 0 && cursor.seg === s.segments.length - 1;
  return plans ? requestNext(moved) : moved;
}
// NEXT/ENDED: after(cursor) ?? (phase "planning" + requestNext)    — outran the DJ: wait, then start when it lands
// SEGMENT_READY: append (trim head to 20, shift cursor); if phase was "planning", moveTo its talk
// SEGMENT_FAILED: retry once, then halt with the error
// TALK_FAILED on the cursor's talk: moveTo item 1 — a broken voice never stalls the show
// TRACK_CHANGED: Spotify moved within the block on its own → cursor follows, no playSeq bump
// JUMP: cursor there, loop running (tapping a row starts the show)
```

Write the reducer first, pure, with tests: next/prev across a segment boundary; prev on the first talk is a
no-op; jump back then play to the tail issues exactly one request; SEGMENT_READY while planning starts it,
while playing appends; stop then run resumes at the same cursor; the 20-cap shifts the cursor; TALK_FAILED
advances; TRACK_CHANGED follows without a playSeq bump.

### 9.2 The effects hook — each effect does one thing

Talk **audio** is not reducer state. The hook keeps a per-session cache `voiceId:segmentId → blob URL` and
fetches by *position*: the segment under the cursor and the one after it. Never by arrival. That's why a
resumed show's past blocks are voiced the instant they're tapped and a rewind is instant. Blobs are dropped
only when their segment leaves the list.

1. **Plan** — when `pending`: `POST /api/station/next` with `{stationId, prompt (read at request time),
   dj: name}`, 120 s abort. 409 → `HALT "another tab is running this station"`. Else `SEGMENT_READY` /
   `SEGMENT_FAILED`.
2. **Voice** — for `segments[cursor.seg]` and `[cursor.seg+1]`: if no cached URL and not in flight,
   `GET /api/tts` → `URL.createObjectURL(blob)`. A failed fetch is stored as an error (and retried later).
3. **Talk on air** — cursor on item 0 and URL ready: `device.pause()`, `device.setVolume(0.15)` (duck),
   `audio.src = url; audio.play()`. `ended` → `ENDED`; error → `TALK_FAILED`. Cleanup pauses the element and
   restores volume (0.8) but does **not** revoke the blob. Cached error → dispatch `TALK_FAILED`.
4. **Tracks on air** — when `playSeq` bumps with the cursor on a track: `device.play(block uris, item-1)`
   — i.e. `PUT /me/player/play` with `{ uris, offset: { position } }`. Spotify then plays through the rest of
   the block by itself; you follow along via `TRACK_CHANGED`.
5. **Stop** — pause both.

The transport: `toggle()` pauses/plays whichever source is under the cursor; `prev()` restarts the current
track if more than 3 s in (the Spotify convention), else `PREV`; `next()` → `NEXT`.

### 9.3 The Spotify device hook

```ts
const p = new Spotify.Player({ name: "Radio", volume: 0.8,
  getOAuthToken: cb => accessToken(clientId).then(cb) });   // your PKCE token from localStorage, refreshed in place
p.addListener("ready", e => setDeviceId(e.device_id));
p.addListener("not_ready", …);                               // device went offline → HALT
p.addListener("player_state_changed", s => {
  // current_track changed → onTrackChanged(uri)
  // end of the list: s.paused && s.position === 0 && s.track_window.next_tracks.length === 0
  //   && current uri === the last uri you handed it && >1.5 s since your play() call  → onTrackListEnded()
});
await p.connect();
```

"List finished" is not an event Spotify gives you — it's that *pattern* in `player_state_changed`, and the
same pattern appears briefly right after a `play()` call, hence the 1.5 s guard. `pause()/resume()` on a
player that has never loaded a list is a `playback_error`; gate on a `loaded` flag. `playback_error` is
per-operation — log it, don't halt.

### 9.4 iOS and the lock screen (you will hit these)

- **Two media elements, both must be unlocked inside a tap.** iOS lets an `HTMLMediaElement` play later only
  if *that element* first played inside a user gesture. On the Run tap, synchronously: create your talk
  `<audio>`, play a few ms of silent WAV (data URI), pause; and call the SDK player's `activateElement()`.
  Fetch the SDK script at page mount, not in the tap — a cold script fetch can eat the activation window.
- **Media Session.** iOS pins Now Playing to whichever element played last, and the SDK writes its own
  metadata on every state change. So set `navigator.mediaSession.metadata`, `playbackState`,
  `setPositionState` and the play/pause/prev/next handlers from the *player face* on every render after a
  handoff, re-asserting your metadata over the SDK's. Register `previoustrack`/`nexttrack` only when the
  cursor can move that way.
- Form controls under 16px zoom the page on focus in Safari: `@media (pointer: coarse) { textarea, select,
  input { font-size: 16px } }`. Do not use `maximum-scale=1`.

### 9.5 Resume and lifecycle

A page load is a fresh show (new station) unless the listener picks a past station from a "Resume a show"
list → `GET /api/station/:id` → `LOAD_SHOW`. Tapping any row or pressing Run continues *that* conversation
(the server's history for that station). Stop inside a page keeps the cursor and the DJ's memory. The DJ
pick is remembered in localStorage; the station is not.

## 10. The supporting cast

- **Auth.** The original is private behind a passkey gate implemented as a single Next.js middleware
  (`proxy.ts`): every request except `api/health` and static assets needs a valid JWT cookie; navigations are
  redirected to the login, API calls get 401. There is deliberately **no user table** — the gate is the whole
  auth story. On Supabase you could use Supabase Auth with a middleware that checks the session instead;
  keep it to one gate, exempt nothing but health + static, and consider leaving `/settings` guarded while the
  station itself is open for friends.
- **Env** (server only, parsed lazily with zod so `next build` needs no values): `DATABASE_URL`,
  `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `CLAUDE_KEY`, `CLAUDE_MODEL` (default a top-tier model —
  the DJ's taste is the product), `ELEVENLABS_KEY` (optional: the station runs with talk skipped until set).
  The Spotify client id is public and also handed to the browser for PKCE.
- **Settings page** (`/settings`, desktop-wide, separate route group and layout from the phone-wide
  station): four prompt textareas with the allowed placeholders listed, and the voice roster editor with
  preview. Server actions write `settings` rows.
- **Segment log.** `segment` rows are history; nothing reads them except "last segment" (for the bridge)
  and the resume list. No provenance yet (a station doesn't record which prompt text planned it) — an easy
  improvement.
- **Tests:** pure logic only — the reducer, trimming/capping/caching, prompt assembly, `resolveFinish`, the
  voice schema, the lock-screen mapping. Anything touching Postgres/Spotify/Claude/ElevenLabs is verified
  live with a written quickstart (§12).

## 11. Building it on Supabase + Railway

**Supabase** = Postgres only. Nothing here needs Auth, Storage, Realtime, or Edge Functions; the design
is stateless functions in one Next.js service. Notes:

- Connect with plain `pg` over the **session pooler** (or direct connection) — `for update skip locked`
  inside an explicit transaction needs a real session, not transaction-mode pooling. Keep the pool small
  (`max: 5`); Railway runs one instance.
- Schema: the original diffs a declarative `schema/*.sql` against the live DB (pg-delta) and needs to
  create a shadow database, which Supabase may not allow. Supabase's own migrations (`supabase db diff` /
  `db push`) are the natural replacement; or keep declarative SQL and diff against a local shadow.
- Dev and prod sharing one database is fine here (it's what the original does) — there's no user data
  beyond stations and settings, and it means the prompts you tune in dev are the prompts on air.
- Seed the four prompt rows and one voice by hand (or a seed script) — the code has no fallback text on
  purpose.

**Railway** = one service, `radio-web`, building the monorepo root with `pnpm --filter web build`, health
check on `/api/health`, secrets as service variables, deploy on push to main. No worker, no cron.

**Spotify app** (developer.spotify.com): register the exact redirect URIs for dev and prod
(`https://<host>/spotify/callback`). Dev must be HTTPS for the SDK and the PKCE callback —
`next dev --experimental-https` with a hosts entry works. While the app is in Development mode, add every
listener's Spotify account under User Management; each needs Premium.

**Order of work that paid off:** schema + settings rows → `packages/dj` with tests (loop, trimming,
prompt assembly) → `/api/station/next` verified with curl (watch the usage log) → Spotify PKCE + device in
the browser, playing a hard-coded block → reducer with tests → the effects hook → TTS + ducking → transport,
cue sheet, resume → iOS/lock screen → settings page.

## 12. Live acceptance scenarios

1. **Cold start** — pick a voice, type a mood, Run: "planning…" → spoken opening within 60 s → first song
   on this tab's device. The cue sheet gains segment 1.
2. **One ahead** — while the opening plays, a second `/api/station/next` is in flight. Let the block play
   out: bridge 2 starts < 1 s after the last song and refers to the block that just played.
3. **Stop / Run** — Stop mid-song: silence, no new `/next`. Run: resumes at the same cursor. Reload, resume
   the station from the list, Run: the DJ continues the same conversation (`segment_count` keeps climbing).
4. **Transport** — next during talk → first song. Pause/play a song → still "running". ⏭ on the last song
   → next talk, or "planning…" if you outran the DJ, then it starts by itself. The following bridge still
   reads naturally after heavy skipping. Tap an earlier row → it plays, no planning request.
5. **DJ switch** — change the voice mid-show: the next bridge is a handoff on air, no cache miss (usage log).
6. **Failure paths** — bogus voice id: talk skipped, songs play, error shown. Break `CLAUDE_KEY`: one retry,
   then the station halts with the error.
7. **Two tabs** — Run in a second tab while the first is planning → 409 shown as "another tab is running
   this station".
8. **Phone** — lock the screen: Now Playing shows the track / "<DJ> on the mic", play/pause and skip work,
   the talk→track handoff happens with the screen locked.

## 13. Traps, collected

- Trusting the model's track ids. Validate against what search returned, always.
- Default 5-minute prompt cache: misses every segment. Use `ttl: "1h"` on both breakpoints, and strip old
  `cache_control` markers so the prefix stays byte-identical.
- Putting the DJ name (or anything per-segment) in the system prompt: cache miss per switch.
- Planning from more than one place in the reducer: double requests, or none. One rule (§9.1).
- Fetching talk audio by arrival instead of position: rewinds and resumes go silent.
- Revoking blob URLs on effect cleanup: the rewind you just made plays nothing.
- Two racing PKCE refreshes: the refresh token rotates, the loser is logged out. Share one in-flight promise.
- Creating the SDK player or the talk `<audio>` outside the tap on iOS: silent forever.
- Reading "end of list" too early after `play()`: the state looks identical for a moment.
- A second tab hitting `/next` without the row lock: two billed plans, a corrupted conversation.
- Prompt text with a fallback in code: two sources of truth; the one on `/settings` silently loses.
