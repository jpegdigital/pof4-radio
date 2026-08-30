// Pre-generate sweepers (voice) and imaging SFX for /program/sweepers. Throwaway practice tooling.
// Run:  op run --env-file=.env.op -- node scripts/sweepers-prep.mjs
// Writes apps/web/public/program/sweepers/{manifest.json, *.mp3}.
import { mkdir, writeFile } from "node:fs/promises";

const OUT = new URL("../apps/web/public/program/sweepers/", import.meta.url);
const { ELEVENLABS_KEY, DATABASE_URL } = process.env;
if (!ELEVENLABS_KEY || !DATABASE_URL)
  throw new Error("ELEVENLABS_KEY / DATABASE_URL missing (run through op run)");

const pg = (await import("../packages/db/node_modules/pg/lib/index.js")).default;
const client = new pg.Client({ connectionString: DATABASE_URL });
await client.connect();
const { rows } = await client.query("select value from settings where key='voices'");
await client.end();
const voice = JSON.parse(rows[0].value)[0];
console.log("voice:", voice.name, voice.modelId);

const sweepers = {
  "sweep-positioning": "More music... less talk. Fifty-six-six... Claude Radio.",
  "sweep-attitude": "Dallas's hit music station. Turn it up — five-six-point-six... WFAI.",
  "sweep-shotgun": "Claude Radio!",
  "sweep-hits": "The eighties... the nineties... all the hits. Fifty-six-six, Claude Radio.",
};

const sfx = {
  "sfx-impact": { text: "deep cinematic boom with a bright metallic transient, short, dry tail", seconds: 2 },
  "sfx-whoosh": { text: "synthetic whoosh rising, 1980s laser zap flavour, electric, bright", seconds: 3 },
  "sfx-slam": { text: "short electronic stab, gated reverb snare hit with a synth chord, 1980s", seconds: 2 },
  "sfx-sting": {
    text: "radio station imaging sting: impact, synth whoosh, electric zap, ending on a gated-drum slam, 1980s Top 40",
    seconds: 5,
  },
};

await mkdir(OUT, { recursive: true });
const out = { voiceId: voice.id, sweepers: {}, sfx: {} };
const H = { "xi-api-key": ELEVENLABS_KEY, "Content-Type": "application/json" };

for (const [name, text] of Object.entries(sweepers)) {
  const r = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voice.id}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: H,
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
  if (!r.ok) throw new Error(`tts ${name}: ${r.status} ${await r.text()}`);
  await writeFile(new URL(`${name}.mp3`, OUT), Buffer.from(await r.arrayBuffer()));
  out.sweepers[name] = text;
  console.log("wrote", name);
}

for (const [name, s] of Object.entries(sfx)) {
  const r = await fetch("https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128", {
    method: "POST",
    headers: H,
    body: JSON.stringify({ text: s.text, duration_seconds: s.seconds, prompt_influence: 0.5 }),
  });
  if (!r.ok) throw new Error(`sfx ${name}: ${r.status} ${await r.text()}`);
  await writeFile(new URL(`${name}.mp3`, OUT), Buffer.from(await r.arrayBuffer()));
  out.sfx[name] = s.text;
  console.log("wrote", name);
}

await writeFile(new URL("manifest.json", OUT), JSON.stringify(out, null, 2));
console.log("done");
