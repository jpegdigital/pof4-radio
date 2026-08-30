import { search } from "@/lib/spotify";
import { loadVoices } from "@/lib/voices";
import { ask, type Usage } from "./ask";
import { MIN_RECORDS } from "./clock-rules";
import { MakeError, writeJson } from "./files";
import { PROGRAM_START_MS } from "../manifest";
import { DISCOVER_TOOL, discoverBrief } from "./prompts";
import { DEFAULT_STATION, MAX_COUNT, MIN_COUNT, type Pick, type Picks, type Record, Request } from "./shapes";

// reads: the request body. writes: request.json, picks.json.

interface Finish {
  rationale: string;
  picks: Pick[];
}

/** Fill what the page left out, clamp the count, and validate as a Request. */
async function requestOf(body: unknown): Promise<Request> {
  const b = (typeof body === "object" && body !== null ? body : {}) as Partial<Request> & { count?: unknown };
  const count =
    typeof b.count === "number" ? Math.min(MAX_COUNT, Math.max(MIN_COUNT, Math.round(b.count))) : 12;
  const dj = b.dj || (await loadVoices())[0]?.name;
  const r = Request.safeParse({
    request: b.request,
    station: b.station ?? DEFAULT_STATION,
    dj,
    startMs: b.startMs ?? PROGRAM_START_MS,
    count,
  });
  if (!r.success) {
    const i = r.error.issues[0];
    throw new MakeError(400, `request: ${i?.path.join(".") || "(root)"} — ${i?.message ?? "invalid"}`);
  }
  return r.data;
}

/** Search the catalogue for a pick; the first hit is the record. */
async function resolve(p: Pick, index: number): Promise<Record | null> {
  const hits = await search(`${p.title} artist:${p.artist}`, 5);
  const t = hits[0];
  if (!t) return null;
  return {
    id: t.id,
    uri: t.uri,
    name: t.name,
    artists: t.artists,
    album: t.album,
    image: t.images[0]?.url ?? null,
    durationMs: t.durationMs,
    pick: index,
  };
}

export async function discover(body: unknown): Promise<{ picks: Picks; usage: Usage }> {
  const req = await requestOf(body);
  await writeJson("request.json", req);
  const { out, usage } = await ask<Finish>(discoverBrief(req), DISCOVER_TOOL, "high");

  const records: Record[] = [];
  const dropped: Picks["dropped"] = [];
  const seen = new Set<string>();
  const resolved = await Promise.allSettled(out.picks.map(resolve));
  resolved.forEach((r, i) => {
    const p = out.picks[i];
    const who = p ? `${p.artist} — ${p.title}` : `pick ${i}`;
    if (r.status === "rejected") {
      dropped.push({ pick: i, reason: `search failed for ${who}: ${String(r.reason)}` });
    } else if (!r.value) {
      dropped.push({ pick: i, reason: `no track for ${who}` });
    } else if (seen.has(r.value.id)) {
      dropped.push({ pick: i, reason: `${who} resolved to a record already in the set` });
    } else {
      seen.add(r.value.id);
      records.push(r.value);
    }
  });

  const picks: Picks = { rationale: out.rationale, picks: out.picks, records, dropped };
  if (records.length < MIN_RECORDS) {
    throw new MakeError(
      422,
      `only ${records.length} of ${out.picks.length} picks resolved (need ${MIN_RECORDS})`,
    );
  }
  await writeJson("picks.json", picks);
  return { picks, usage };
}
