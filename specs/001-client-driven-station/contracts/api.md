# HTTP contracts

All routes sit behind Guard (`apps/web/src/proxy.ts`); only `api/health` is exempt. JSON unless noted.

## POST /api/station/next

Plan the next segment for a station, continuing its DJ conversation.

Request:
```json
{ "stationId": "uuid | null", "prompt": "string (1–500 chars)" }
```
`stationId: null` creates a station.

Response 200:
```json
{
  "stationId": "uuid",
  "segment": {
    "id": "uuid", "seq": 7, "talk": "string",
    "tracks": [{ "id": "…", "uri": "spotify:track:…", "name": "…", "artists": ["…"], "album": "…", "durationMs": 252000 }]
  }
}
```
Errors: 400 invalid body · 404 unknown station · 409 `{ "error": "busy" }` (another request is planning this
station) · 502 `{ "error": "<dj failure message>" }` (model refusal, no tracks, turn cap). Typical latency
20–60 s; the client uses no timeout shorter than 120 s.

Side effects: appends the trimmed turn to `station.messages`, inserts a `segment` row, bumps `segment_count`,
updates `station.prompt`.

## GET /api/station/:id

Returns `{ stationId, prompt, segmentCount, segments: [last 20 segment rows, newest first] }` for the history
list and for rehydrating after reload. 404 if unknown.

## GET /api/tts

Stream the DJ's talk as audio.

Query: `text` (≤ 5000 chars, required) · `voiceId` (required) · `modelId` (default `eleven_v3`) · `stability`,
`similarityBoost`, `style` (0–1) · `speed` (0.7–1.2) · `speakerBoost` (`true|false`).

Response 200: `Content-Type: audio/mpeg`, chunked body piped from ElevenLabs
`POST /v1/text-to-speech/{voiceId}/stream?output_format=mp3_44100_128`. Upstream errors are forwarded as
502 with `{ "error": "<upstream message>" }`. The server adds `xi-api-key` from `ELEVENLABS_KEY` and nothing
else; no caching headers (the client holds the Blob).

## GET /api/tts/voices

Returns `[{ "voiceId", "name", "category" }]` from ElevenLabs `GET /v1/voices` for the settings panel.

## Unchanged

`/api/spotify/login`, `/api/spotify/callback`, `/api/spotify/token`, `/api/health`.

## Removed

Server action `requestSegment`/`segmentPlayed`, `lib/queue.ts`, pg-boss queue `segment`, the `radio-worker`
service and `apps/worker` package.
