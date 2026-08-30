// Pre-generate a Claude-planned program in two parts: the open over the manifest's songs, then
// the top of the hour over five more, each part asked of /api/program/clock (the dev server must
// be up) with the part before it as context; every line voiced; one clock written for the player.
// Run:  op run --env-file=.env.op -- node scripts/clock-prep.mjs
// Writes apps/web/public/program/{clock.json, clock-*.mp3}. Throwaway practice tooling.
import { mkdir, readFile, writeFile } from "node:fs/promises";

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"; // the dev cert
const OUT = new URL("../apps/web/public/program/", import.meta.url);
const { ELEVENLABS_KEY, DATABASE_URL, SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET } = process.env;
if (!ELEVENLABS_KEY || !DATABASE_URL || !SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET)
  throw new Error("env missing (run through op run)");
/** A talk-up ends this long before the post. */
const BEAT_MS = 400;

const m = JSON.parse(await readFile(new URL("manifest.json", OUT), "utf8"));
const pg = (await import("../packages/db/node_modules/pg/lib/index.js")).default;
const client = new pg.Client({ connectionString: DATABASE_URL });
await client.connect();
const { rows } = await client.query("select value from settings where key='voices'");
await client.end();
const voice = JSON.parse(rows[0].value)[0];
console.log("voice:", voice.name, voice.modelId);

// --- Spotify (app token): the second part's songs ---
const tok = await fetch("https://accounts.spotify.com/api/token", {
  method: "POST",
  headers: {
    Authorization: `Basic ${Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString("base64")}`,
    "Content-Type": "application/x-www-form-urlencoded",
  },
  body: "grant_type=client_credentials",
}).then((r) => r.json());
async function track(q) {
  const r = await fetch(
    `https://api.spotify.com/v1/search?${new URLSearchParams({ q, type: "track", limit: "5", market: "US" })}`,
    { headers: { Authorization: `Bearer ${tok.access_token}` } },
  ).then((r) => r.json());
  const t = r.tracks.items[0];
  if (!t) throw new Error(`no track for ${q}`);
  return {
    uri: t.uri,
    name: t.name,
    artists: t.artists.map((a) => a.name),
    album: t.album.name,
    image: t.album.images[0]?.url ?? null,
    durationMs: t.duration_ms,
  };
}
const more = [
  await track("Take On Me artist:a-ha"),
  await track("Livin' On A Prayer artist:Bon Jovi"),
  await track("Sweet Dreams (Are Made of This) artist:Eurythmics"),
  await track("Billie Jean artist:Michael Jackson"),
  await track("Vogue artist:Madonna"),
];
const songs = [...m.songs, ...more];

/** One part: ask Claude for the plan and the words over `set` (indices offset into `songs`). */
async function part(mode, set, offset, time, previous) {
  const res = await fetch("https://dev.radio.pof4.com:3000/api/program/clock", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      mode,
      station: m.station,
      dj: voice.name,
      time,
      songs: set.map((s) => ({ name: s.name, artists: s.artists, durationMs: s.durationMs })),
      previous,
    }),
  });
  const r = await res.json();
  if (!res.ok) throw new Error(`clock ${mode}: ${res.status} ${r.error}`);
  console.log(`${mode}: planned in ${r.timing.planMs} ms, written in ${r.timing.wordsMs} ms`);
  return r.plan.slots.map((p) => {
    const w = r.words.slots.find((x) => x.song === p.song);
    const slot = { ...p, song: p.song + offset, words: w?.words?.trim() ?? "" };
    if (w?.legalId?.trim()) slot.legalId = w.legalId.trim();
    return slot;
  });
}
/** A part as lines of context for the next one. */
const recap = (slots) =>
  slots.map((s) => {
    const t = songs[s.song];
    const said = [s.legalId, s.words].filter(Boolean).join(" ");
    return `- ${s.intro}${said ? `: "${said}"` : ""} -> ${t.artists.join(", ")} - ${t.name}`;
  });

const first = await part("open", m.songs, 0, "8:43 PM", undefined);
const second = await part("top", more, m.songs.length, "9:00 PM", recap(first));
const plan = [...first, ...second];

async function tts(name, text) {
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voice.id}/with-timestamps?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": ELEVENLABS_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        model_id: voice.modelId,
        voice_settings: {
          stability: voice.stability,
          similarity_boost: voice.similarityBoost,
          style: voice.style,
          speed: voice.speed,
          use_speaker_boost: voice.speakerBoost,
        },
      }),
    },
  );
  if (!res.ok) throw new Error(`tts ${name}: ${res.status} ${await res.text()}`);
  const { audio_base64, alignment } = await res.json();
  await writeFile(new URL(`${name}.mp3`, OUT), Buffer.from(audio_base64, "base64"));
  const ends = alignment.character_end_times_seconds;
  return {
    durationMs: Math.round(ends[ends.length - 1] * 1000),
    chars: alignment.characters.join(""),
    starts: alignment.character_start_times_seconds,
  };
}

/** Where the last sentence starts in the clip: the line that leads into the song. */
function lastLineMs(a) {
  const i = a.chars.search(/[.!?]\s+[^.!?]*[.!?]?\s*$/);
  return i < 0 ? a.durationMs : Math.round(a.starts[i + 1] * 1000);
}

await mkdir(OUT, { recursive: true });
const slots = [];
for (const slot of plan) {
  const p = slot;
  const text = [slot.legalId, slot.words].filter(Boolean).join(" ");
  if (text) {
    const name = `clock-${p.song}`;
    const a = await tts(name, text);
    slot.clip = name;
    slot.durationMs = a.durationMs;
    if (p.intro === "break") slot.leadMs = a.durationMs - lastLineMs(a);
    if (slot.legalId) slot.bedInMs = Math.round(a.starts[slot.legalId.length + 1] * 1000);
    if (p.intro === "talkup") {
      slot.atMs = Math.max(0, p.introMs - a.durationMs - BEAT_MS);
      if (a.durationMs + BEAT_MS > p.introMs)
        console.warn(
          `  ! ${name}: ${a.durationMs} ms of talk over a ${p.introMs} ms intro - steps on the post`,
        );
    }
    console.log(
      `${name} ${p.intro} ${a.durationMs} ms`,
      slot.leadMs != null ? `lead ${slot.leadMs}` : "",
      slot.atMs != null ? `at ${slot.atMs}` : "",
      slot.bedInMs != null ? `bed in ${slot.bedInMs}` : "",
    );
  } else console.log(`song ${p.song} ${p.intro}`);
  slots.push(slot);
}

await writeFile(
  new URL("clock.json", OUT),
  JSON.stringify({ station: m.station, dj: voice.name, voiceId: voice.id, songs, slots }, null, 2),
);
console.log("clock written");
