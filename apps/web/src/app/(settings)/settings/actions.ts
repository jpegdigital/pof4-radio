"use server";

import { revalidatePath } from "next/cache";
import { pool } from "@/lib/db";
import { IDENTITY_KEY, Identity } from "@/lib/identity";
import { loadVoices } from "@/lib/settings";
import { type Voice, VOICES_KEY, VoiceSchema, VoicesSchema } from "@/lib/voices";

/**
 * /settings Server Actions. Identity: one JSON row, read per segment when the brief is written.
 * Voices: the roster is one JSON row (`settings.voices`); every change reads it, edits it, writes
 * it back — the next clip voiced reads the change, clips already kept keep their voice.
 */

export type SaveState = { error?: string; savedAt?: string };

/** One settings row, written or replaced. */
async function saveSetting(key: string, value: string): Promise<void> {
  await pool().query(
    "insert into settings (key, value) values ($1, $2) on conflict (key) do update set value = excluded.value",
    [key, value],
  );
}

// ---- identity -----------------------------------------------------------------

export async function saveIdentity(_prev: SaveState, formData: FormData): Promise<SaveState> {
  const field = (name: string) => {
    const v = formData.get(name);
    return typeof v === "string" ? v.trim() : "";
  };
  const parsed = Identity.safeParse({ calls: field("calls"), city: field("city"), onAir: field("onAir") });
  if (!parsed.success)
    return { error: "Every field is needed: call letters, city, the name as said on air." };
  await saveSetting(IDENTITY_KEY, JSON.stringify(parsed.data));
  revalidatePath("/settings");
  revalidatePath("/");
  return { savedAt: new Date().toISOString() };
}

// ---- voices -------------------------------------------------------------------

async function writeRoster(voices: Voice[]): Promise<void> {
  await saveSetting(VOICES_KEY, JSON.stringify(VoicesSchema.parse(voices)));
  revalidatePath("/settings");
}

export type VoiceState = { error?: string; savedAt?: string; id?: string };

/** Save one voice as the form holds it. `was` is the id it had when the form opened ("" for a new one). */
export async function saveVoice(_prev: VoiceState, formData: FormData): Promise<VoiceState> {
  const raw = formData.get("voice");
  let json: unknown = null;
  try {
    json = typeof raw === "string" ? JSON.parse(raw) : null;
  } catch {
    // stays null — rejected below
  }
  const parsed = VoiceSchema.safeParse(json);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the voice." };
  const voice = parsed.data;
  const wasRaw = formData.get("was");
  const was = typeof wasRaw === "string" ? wasRaw : "";
  const roster = await loadVoices();
  const at = roster.findIndex((v) => v.id === was);
  if (roster.some((v, i) => v.id === voice.id && i !== at))
    return { error: "Another voice already has that id." };
  const next = at === -1 ? [...roster, voice] : roster.with(at, voice);
  await writeRoster(next);
  return { savedAt: new Date().toISOString(), id: voice.id };
}

export async function deleteVoice(id: string): Promise<void> {
  await writeRoster((await loadVoices()).filter((v) => v.id !== id));
}

/** Move a voice one step up (-1) or down (+1); the first in the roster is the default. */
export async function moveVoice(id: string, by: -1 | 1): Promise<void> {
  const roster = await loadVoices();
  const i = roster.findIndex((v) => v.id === id);
  const j = i + by;
  if (i === -1 || j < 0 || j >= roster.length) return;
  const next = [...roster];
  [next[i], next[j]] = [next[j], next[i]];
  await writeRoster(next);
}
