"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { enqueueSegment } from "@/lib/queue";

/** The listener asks for something → a `queued` segment row + its job. */
export async function requestSegment(listenerPrompt: string): Promise<{ id: string }> {
  const prompt = listenerPrompt.trim().slice(0, 500);
  if (!prompt) throw new Error("say what you'd like to hear");
  const segment = await db().createSegment(prompt);
  try {
    await enqueueSegment(segment.id);
  } catch (err) {
    await db().failSegment(
      segment.id,
      `could not queue: ${err instanceof Error ? err.message : String(err)}`,
    );
    throw err;
  }
  revalidatePath("/");
  return { id: segment.id };
}

/** The player finished a segment (or skipped it): it won't be offered again. */
export async function segmentPlayed(id: string): Promise<void> {
  await db().markPlayed(id);
  revalidatePath("/");
}
