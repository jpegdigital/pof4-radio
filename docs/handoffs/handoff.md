# Handoff: prepare news and weather before the listener presses play

Date: 2026-09-19
Status: proposal only. No runtime changes, cron jobs, or schema changes authorized by this handoff.

## Goal

Opening a show should read prepared news and weather from the database, select what fits,
write one short DJ script, and generate one voice take. Research belongs in scheduled work,
where we can spend more time finding good sources and preparing useful material.

## Why

The current opening is a break. Its preparation includes news discovery/editing/checking,
live weather retrieval, DJ copy, the primary voice take, and a second news-free voice take.
The last recorded timing had roughly 28 seconds of news editing and 22 seconds of voice
generation across the two takes; the DJ's music copy itself took about four seconds.
These are earlier measurements, not a new benchmark. See [Jev planning](../jev-planning.md).

## Scheduled preparation

- Add an overnight cron job, or separate news and weather jobs, with a larger research budget.
  Find rich, relevant news sources, check the supporting material, and save ready-to-use entries.
  Collect useful weather observations and forecasts for the station's configured location.
- Keep the storage simple: probably two tables, provisionally `news_entries` and `weather_entries`.
  News can be a dated row containing a batch of headlines and rich, largely unstructured source
  material. Weather should be structured data, not prose that has to be parsed again.
- Include preparation time, validity/expiry, and source attribution. News entries should retain
  publication times and enough checked context for accurate short copy. Weather should retain
  location, units, observation/forecast times, conditions, temperatures, precipitation, and
  relevant alerts when available. Distinguish a forecast from a current observation.
- Publish a prepared entry only when complete. Retain earlier entries for traceability.
  Decide the refresh cadence during implementation: overnight preparation is the starting point,
  but weather validity and changing headlines may justify additional scheduled refreshes.

## Show preparation

1. Read the latest usable news and weather entries from the database. No source searching,
   live weather fetch, or separate news editing model call on the listener's request.
2. Jev selects which prepared headlines, if any, suit the show and have not already been used.
   Selection uses the listener's request and recent show history.
3. Give Claude the selected, checked headline material, structured weather, and existing DJ/mix
   brief together. Claude writes the final concise spoken script in one call. Weather is a
   straightforward rendering of supplied facts; neither model needs to research it again.
4. Generate one TTS take from that script. Remove the automatically generated news-free backup
   and the parallel news-specific writing path. Explicit user-requested voice retries remain separate.

If usable news or weather is missing or expired, omit that portion before writing the script
and continue. Do not turn missing prepared material into on-demand research or a second voice take.
Define how long a prepared clip can wait before airing during implementation, so stale material
does not require routinely preparing two versions of every opening.

## Implementation pointers and completion checks

Start at `apps/web/src/app/api/sessions/[id]/slots/[seq]/route.ts`, `headlines.ts`,
`headline-edit.ts`, `weather.ts`, and `write.ts`. Existing `headline_snapshot`, `headline_story`,
and news-exposure storage already hold evidence/history; decide what to reuse or retire before
adding the proposed tables. Preserve source checks in scheduled preparation and avoid a second
competing news pipeline.

Verify that a fresh opening uses database reads, Jev selection/planning, one Claude copy call,
and one TTS call for its news/weather/DJ portion. Check missing/stale entries and repeat-headline
selection, then measure time to first audio and listen to the result. Music discovery and track
downloads remain separate contributors to startup time.

Next step: review this proposal with the user before implementation. This request is documentation only.
