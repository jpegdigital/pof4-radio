import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { parseVoices, PROMPT_SLOTS, type PromptKey, type Voice, VOICES_KEY } from "@radio/dj";
import { db } from "@/lib/db";
import { PromptEditor } from "./prompt-editor";
import { VoiceEditor } from "./voice-editor";

export const metadata: Metadata = { title: "Settings · Radio" };
export const dynamic = "force-dynamic";

/**
 * /settings — the DJ's script and the DJs' voices, one at a time. A rail on the left — the four
 * prompt slots, then the voice roster — chosen by `?slot=` or `?voice=` so the page stays a
 * Server Component; the editor for the pick on the right. Everything is a `settings` row —
 * the only place it lives; a slot with no row is a fault the rail flags, a roster with no row
 * is empty. Saving applies to the next block planned / the next line voiced.
 */
const isKey = (s: unknown): s is PromptKey => PROMPT_SLOTS.some((p) => p.key === s);

const railItem = (active: boolean) =>
  `flex min-h-10 items-center gap-3 whitespace-nowrap rounded-md px-3 text-sm transition ${
    active ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
  }`;

const railList = "-mx-5 flex gap-1 overflow-x-auto px-5 md:mx-0 md:flex-col md:overflow-visible md:px-0";

export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  const [{ slot: requestedSlot, voice: requestedVoice }, rows] = await Promise.all([
    searchParams,
    db().listSettings(),
  ]);
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const rosterRow = byKey.get(VOICES_KEY);
  let voices: Voice[] = [];
  let rosterFault: string | null = null;
  try {
    voices = rosterRow ? parseVoices(rosterRow.value) : [];
  } catch (err) {
    rosterFault = err instanceof Error ? err.message : String(err);
  }

  // What's open: a voice if `?voice=` names one (or "new"), else a prompt slot.
  const openVoice =
    typeof requestedVoice === "string" ? voices.find((v) => v.id === requestedVoice) : undefined;
  const newVoice = requestedVoice === "new";
  const showVoice = Boolean(openVoice) || newVoice;
  const key: PromptKey = isKey(requestedSlot) ? requestedSlot : PROMPT_SLOTS[0].key;
  const slot = PROMPT_SLOTS.find((s) => s.key === key)!;
  const row = byKey.get(key);

  return (
    <div className="grid items-start gap-8 md:grid-cols-[14rem_minmax(0,1fr)] md:gap-12">
      <nav aria-label="Settings" className="flex flex-col gap-6 md:sticky md:top-8">
        <div>
          <p className="mb-3 font-display text-sm uppercase tracking-[0.2em] text-zinc-500">DJ script</p>
          <ul className={railList}>
            {PROMPT_SLOTS.map((s) => {
              const active = !showVoice && s.key === key;
              const on = byKey.has(s.key);
              return (
                <li key={s.key} className="shrink-0">
                  <Link
                    href={`/settings?slot=${s.key}`}
                    aria-current={active ? "page" : undefined}
                    className={railItem(active)}
                  >
                    <Lamp on={on} />
                    <span className="flex-1">{s.label}</span>
                    {!on && <Fault>missing</Fault>}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>

        <div>
          <p className="mb-3 font-display text-sm uppercase tracking-[0.2em] text-zinc-500">Voices</p>
          <ul className={railList}>
            {voices.map((v, i) => {
              const active = openVoice?.id === v.id;
              return (
                <li key={v.id} className="shrink-0">
                  <Link
                    href={`/settings?voice=${encodeURIComponent(v.id)}`}
                    aria-current={active ? "page" : undefined}
                    className={railItem(active)}
                  >
                    <Lamp on />
                    <span className="flex-1">{v.name}</span>
                    {i === 0 && (
                      <span className="font-display text-xs uppercase tracking-[0.15em] text-zinc-600">
                        default
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
            {rosterFault && (
              <li className="shrink-0 px-3 py-2 text-xs leading-relaxed text-red-400">
                <Fault>bad row</Fault>
                <br />
                {rosterFault}
              </li>
            )}
            <li className="shrink-0">
              <Link
                href="/settings?voice=new"
                aria-current={newVoice ? "page" : undefined}
                className={railItem(newVoice)}
              >
                <span aria-hidden className="size-1.5" />
                <span className="flex-1 text-zinc-500">+ Add a voice</span>
              </Link>
            </li>
          </ul>
        </div>

        <p className="hidden text-xs leading-relaxed text-zinc-600 md:block">
          This is the script and the roster themselves — there is no copy in code. A change reaches the next
          block the DJ plans and the next line it voices; what&rsquo;s already buffered keeps its own.
        </p>
      </nav>

      {showVoice ? (
        <VoiceEditor
          key={`${openVoice?.id ?? "new"}:${rosterRow?.updatedAt.toISOString() ?? ""}`}
          voice={openVoice ?? null}
          index={openVoice ? voices.indexOf(openVoice) : -1}
          count={voices.length}
          updatedAt={rosterRow?.updatedAt.toISOString() ?? null}
        />
      ) : (
        <PromptEditor
          key={`${key}:${row?.updatedAt.toISOString() ?? "missing"}`}
          slot={slot}
          value={row?.value ?? ""}
          updatedAt={row?.updatedAt.toISOString() ?? null}
        />
      )}
    </div>
  );
}

function Lamp({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={`size-1.5 rounded-full ${on ? "bg-lamp shadow-[0_0_6px_var(--color-lamp)]" : "bg-zinc-700"}`}
    />
  );
}

function Fault({ children }: { children: ReactNode }) {
  return <span className="font-display text-xs uppercase tracking-[0.15em] text-red-400">{children}</span>;
}
