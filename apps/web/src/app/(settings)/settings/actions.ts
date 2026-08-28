"use server";

import { revalidatePath } from "next/cache";
import { PROMPT_SLOTS, type PromptKey } from "@radio/dj";
import { z } from "zod";
import { db } from "@/lib/db";

/**
 * /settings Server Actions: save one prompt slot, or put it back to its code default. The
 * next segment reads the change (`loadPromptTemplate`); segments already planned keep theirs.
 */

export type SaveState = { error?: string; savedAt?: string };

const Key = z.enum(PROMPT_SLOTS.map((s) => s.key) as [PromptKey, ...PromptKey[]]);
const Save = z.object({
  key: Key,
  value: z.string().trim().min(1, "The prompt can't be empty.").max(20_000),
});

export async function savePrompt(_prev: SaveState, formData: FormData): Promise<SaveState> {
  const parsed = Save.safeParse({ key: formData.get("key"), value: formData.get("value") ?? "" });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the prompt." };
  await db().saveSetting(parsed.data.key, parsed.data.value);
  revalidatePath("/settings");
  return { savedAt: new Date().toISOString() };
}

export async function resetPrompt(_prev: SaveState, formData: FormData): Promise<SaveState> {
  const key = Key.safeParse(formData.get("key"));
  if (!key.success) return { error: "Unknown prompt." };
  await db().deleteSetting(key.data);
  revalidatePath("/settings");
  return {};
}
