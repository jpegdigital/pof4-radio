import { template } from "./template.ts";
import { z } from "zod";
import type { Identity } from "../identity.ts";
import type { Album, AlbumTrack, Found } from "../../app/api/sessions/qobuz.ts";
import { numbered, Proposal } from "../../app/api/sessions/shapes.ts";
import { ChatPrompt } from "./contract.ts";

export interface Taken {
  title: string;
  artist: string;
}

export interface FillInput {
  prompt: string;
  dj: string | null;
  identity: Identity;
  /** Written slots so far, in show order. */
  played: Taken[];
  /** Proposed slots not yet written, in show order. */
  pending: Taken[];
  /** How many slots to make. */
  count: number;
}

const list = (songs: Taken[]) => songs.map((s) => `- ${s.artist} — ${s.title}`).join("\n");

const mmss = (ms: number) =>
  `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;

/** A search result as the proposer reads it: each bucket that came back, ids first, so the album tool can take one. */
export function foundText(f: Found): string {
  const out: string[] = [];
  if (f.albums.length) {
    out.push("albums:");
    for (const a of f.albums)
      out.push(`  ${a.id}  ${a.artist} — ${a.title} (${a.tracks} tracks, ${a.released})`);
  }
  if (f.tracks.length) {
    out.push("tracks:");
    for (const t of f.tracks)
      out.push(`  ${t.id}  ${t.artists.join(", ")} — ${t.title}  (${t.album}, ${mmss(t.durationMs)})`);
  }
  if (f.artists.length) {
    out.push("artists:");
    for (const a of f.artists) out.push(`  ${a.id}  ${a.name} (${a.albums} albums)`);
  }
  if (f.playlists.length) {
    out.push("playlists:");
    for (const p of f.playlists) out.push(`  ${p.id}  ${p.name} (${p.tracks} tracks, by ${p.by})`);
  }
  return out.length ? out.join("\n") : "nothing found";
}

/** A record's tracklist as the proposer reads it: numbered in the record's order, a second disc as 2-1. */
export function albumText(album: Album, tracks: AlbumTrack[]): string {
  const multi = tracks.some((t) => t.disc > 1);
  return [
    `${album.artist} — ${album.title} (${album.released}), ${album.tracks} tracks`,
    ...tracks.map(
      (t) =>
        `${multi && t.disc > 1 ? `${t.disc}-` : ""}${t.number}. ${t.title} (${mmss(t.durationMs)})${t.streamable ? "" : " — not streamable"}`,
    ),
  ].join("\n");
}

/** The brief: the ask, the station, the catalog and how to use it, what has played, what is coming, and what the first song must be. */
const renderSystem = template("fill-system", z.strictObject({}));
const renderBrief = template(
  "fill-brief",
  z.strictObject({
    direction: z.string(),
    station: z.string().min(1),
    calls: z.string().min(1),
    city: z.string().min(1),
    dj: z.string().nullable(),
    played: z.string(),
    pending: z.string(),
    fresh: z.boolean(),
    count: z.number().int().positive(),
    followingCount: z.number().int().nonnegative(),
  }),
);

export function fillBrief(input: FillInput, propose: number): string {
  return renderBrief({
    direction: input.prompt,
    station: input.identity.onAir,
    calls: input.identity.calls,
    city: input.identity.city,
    dj: input.dj,
    played: list(input.played),
    pending: list(input.pending),
    fresh: input.played.length === 0 && input.pending.length === 0,
    count: propose,
    followingCount: propose - 1,
  });
}

export const fillPrompt = {
  tools: {
    search:
      "Search the Qobuz catalog by name. Use it before naming anything you are not sure of: a record or a song you don't know, a release newer than you remember, an artist's latest. Returns ids; an album id goes to the album tool.",
    query: "artist and title, or artist alone — plain words, no field syntax",
    kind: "all: the first look at the show brief — albums, tracks, artists and playlists side by side. albums: the brief names a record, or you want an artist's newest. tracks: confirm one song exists and see its versions. artists, playlists: when the brief names one.",
    album:
      "A record's tracks in the catalog's order, by the album id a search returned. Use it whenever the brief names a record, or to see what is on a release you don't know.",
    albumId: "the album id from a search hit",
  },
  render(input: FillInput, propose: number): ChatPrompt {
    return ChatPrompt.parse({ system: renderSystem({}), brief: fillBrief(input, propose) });
  },
  output(input: FillInput, propose: number) {
    const fresh = input.played.length === 0 && input.pending.length === 0;
    const named = numbered("song", propose, Proposal);
    const output = z
      .object({
        rationale: z
          .string()
          .describe(
            fresh
              ? "your programming intent, what you looked up, and why the opener sets up your show — a short paragraph in your own words"
              : "how these carry the show on from where it stands — a short paragraph in your own words",
          ),
        ...named.shape,
      })
      .describe(
        `${propose} songs, one per slot, in the order you would play them: leads for a catalogue search, the strongest first.`,
      );
    return { output, list: named.list };
  },
};
