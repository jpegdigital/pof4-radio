// Pre-generate the practice program: Spotify track ids + ElevenLabs clips for every talk element.
// Run:  op run --env-file=.env.op -- node scripts/program-prep.mjs
// Writes apps/web/public/program/{manifest.json, *.mp3}. Throwaway practice tooling.
import { mkdir, writeFile } from "node:fs/promises";

const OUT = new URL("../apps/web/public/program/", import.meta.url);
const { SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, ELEVENLABS_KEY, DATABASE_URL } = process.env;
for (const [k, v] of Object.entries({
  SPOTIFY_CLIENT_ID,
  SPOTIFY_CLIENT_SECRET,
  ELEVENLABS_KEY,
  DATABASE_URL,
}))
  if (!v) throw new Error(`${k} missing (run through op run)`);

const STATION = "WFAI, 56.6, Claude Radio";

// The default voice = the roster's first.
const pg = (await import("../packages/db/node_modules/pg/lib/index.js")).default;
const client = new pg.Client({ connectionString: DATABASE_URL });
await client.connect();
const { rows } = await client.query("select value from settings where key='voices'");
await client.end();
const voice = JSON.parse(rows[0].value)[0];
console.log("voice:", voice.name, voice.modelId);

// --- Spotify (app token) ---
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

const songs = [
  await track("Hungry Like the Wolf artist:Duran Duran"),
  await track("How Will I Know artist:Whitney Houston"),
  await track("Everybody Wants to Rule the World artist:Tears for Fears"),
  await track("Let's Go Crazy artist:Prince"),
  await track("Rhythm Nation artist:Janet Jackson"),
];
const bed = await track("Crockett's Theme artist:Jan Hammer");
for (const s of [...songs, bed])
  console.log(`${s.artists.join(", ")} — ${s.name}  ${Math.round(s.durationMs / 1000)}s  ${s.uri}`);

// --- The talk elements ---
// Each clip: its text, plus optional marks — `lead`: the phrase the next song starts under (its
// start time → leadMs from the clip's end); `bedIn`: the phrase the bed comes in on (the words
// before it are dry). Timings come from ElevenLabs' character alignment, not guesswork.
const clips = {
  "break-small": {
    text: `${STATION} — the Hit Music Station. It's 8:43 on a Saturday night, 84 degrees right now in Dallas, still gonna be 79 at midnight, so the windows are down. Right now on 56.6, Claude Radio — Duran Duran.`,
  },
  "talkup-2": { text: `Duran Duran on 56.6, Claude Radio — 8:47 — here's Whitney.` },
  "talkup-3": { text: `Claude Radio, 56.6. Saturday night keeps rolling — this is Tears for Fears.` },
  "talkup-4": { text: `Eighty-four degrees, 8:56, Claude Radio — Prince.` },
  "break-big": {
    text: `WFAI, Dallas. 56.6, Claude Radio. Nine o'clock on 56.6, Claude Radio, I'm ${voice.name} with you till midnight. 84 degrees in Dallas, clear skies, low tonight 74, and tomorrow another hot one, 97 with a slight chance of a storm late. Headlines at nine: the city council approved the new downtown transit plan tonight after a six-hour session. The Cowboys open the preseason at home tomorrow afternoon. And a rare lunar eclipse will be visible across Texas just after midnight. Coming up this hour: Bon Jovi back to back, and more of the hits before ten. Don't go anywhere. Brand new on 56.6, Claude Radio — this is Janet Jackson.`,
    bedIn: "Nine o'clock",
    lead: "Brand new on 56.6",
  },
};

await mkdir(OUT, { recursive: true });
const out = {};
for (const [name, c] of Object.entries(clips)) {
  const r = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voice.id}/with-timestamps?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": ELEVENLABS_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        text: c.text,
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
  if (!r.ok) throw new Error(`tts ${name}: ${r.status} ${await r.text()}`);
  const { audio_base64, alignment } = await r.json();
  await writeFile(new URL(`${name}.mp3`, OUT), Buffer.from(audio_base64, "base64"));
  const chars = alignment.characters.join("");
  const ends = alignment.character_end_times_seconds;
  const durationMs = Math.round(ends[ends.length - 1] * 1000);
  const at = (phrase) => {
    const i = chars.indexOf(phrase);
    if (i < 0) throw new Error(`${name}: "${phrase}" not in the clip`);
    return Math.round(alignment.character_start_times_seconds[i] * 1000);
  };
  const entry = { text: c.text, durationMs };
  if (c.bedIn) entry.bedInMs = at(c.bedIn);
  if (c.lead) entry.leadMs = durationMs - at(c.lead);
  out[name] = entry;
  console.log("wrote", name, entry.durationMs + "ms", entry.bedInMs ?? "", entry.leadMs ?? "");
}

await writeFile(
  new URL("manifest.json", OUT),
  JSON.stringify({ station: STATION, dj: voice.name, voiceId: voice.id, songs, bed, clips: out }, null, 2),
);
console.log("manifest written");
