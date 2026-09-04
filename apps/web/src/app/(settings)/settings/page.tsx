import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { CLOCK_KEY, Clock } from "@/lib/clock";
import { pool } from "@/lib/db";
import { IDENTITY_KEY, Identity } from "@/lib/identity";
import { parseVoices, type Voice, VOICES_KEY } from "@/lib/voices";
import { ClockEditor } from "./clock-editor";
import { IdentityEditor } from "./identity-editor";
import { VoiceEditor } from "./voice-editor";

export const metadata: Metadata = { title: "Settings · Radio" };
export const dynamic = "force-dynamic";

/**
 * /settings — the station's identity, its clock and the DJs' voices, one at a time. A rail on
 * the left — the identity, the clock, then the voice roster — chosen by `?clock=` / `?voice=` so
 * the page stays a Server Component; the editor for the pick on the right. Everything is a
 * `settings` row — the only place it lives; a roster with no row is empty, a clock or identity
 * with no row is a fault the show throws on. Saving applies to the next slot produced.
 */

const railItem = (active: boolean) =>
  `flex min-h-10 items-center gap-3 whitespace-nowrap rounded-md px-3 text-sm transition ${
    active ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
  }`;

const railList = "-mx-5 flex gap-1 overflow-x-auto px-5 md:mx-0 md:flex-col md:overflow-visible md:px-0";

export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  const [{ voice: requestedVoice, clock: requestedClock }, { rows }] = await Promise.all([
    searchParams,
    pool().query<{ key: string; value: string; updated_at: Date }>(
      "select key, value, updated_at from settings where key = any($1::text[])",
      [[IDENTITY_KEY, CLOCK_KEY, VOICES_KEY]],
    ),
  ]);
  const byKey = new Map(rows.map((r) => [r.key, { value: r.value, updatedAt: r.updated_at }]));
  const rosterRow = byKey.get(VOICES_KEY);
  let voices: Voice[] = [];
  let rosterFault: string | null = null;
  try {
    voices = rosterRow ? parseVoices(rosterRow.value) : [];
  } catch (err) {
    rosterFault = err instanceof Error ? err.message : String(err);
  }

  // What's open: a voice if `?voice=` names one (or "new"), else the identity.
  const openVoice =
    typeof requestedVoice === "string" ? voices.find((v) => v.id === requestedVoice) : undefined;
  const newVoice = requestedVoice === "new";
  const showVoice = Boolean(openVoice) || newVoice;
  const showClock = !showVoice && requestedClock !== undefined;
  const showIdentity = !showVoice && !showClock;
  const identityRow = byKey.get(IDENTITY_KEY);
  let identity: Identity | null = null;
  try {
    identity = identityRow ? Identity.parse(JSON.parse(identityRow.value)) : null;
  } catch {
    identity = null;
  }
  const clockRow = byKey.get(CLOCK_KEY);
  let clock: Clock | null = null;
  try {
    clock = clockRow ? Clock.parse(JSON.parse(clockRow.value)) : null;
  } catch {
    clock = null;
  }

  return (
    <div className="grid items-start gap-8 md:grid-cols-[14rem_minmax(0,1fr)] md:gap-12">
      <nav aria-label="Settings" className="flex flex-col gap-6 md:sticky md:top-8">
        <div>
          <p className="mb-3 font-display text-sm uppercase tracking-[0.2em] text-zinc-500">Station</p>
          <ul className={railList}>
            <li className="shrink-0">
              <Link
                href="/settings"
                aria-current={showIdentity ? "page" : undefined}
                className={railItem(showIdentity)}
              >
                <Lamp on={identity !== null} />
                <span className="flex-1">Identity</span>
                {identity === null && <Fault>missing</Fault>}
              </Link>
            </li>
            <li className="shrink-0">
              <Link
                href="/settings?clock=1"
                aria-current={showClock ? "page" : undefined}
                className={railItem(showClock)}
              >
                <Lamp on={clock !== null} />
                <span className="flex-1">Clock</span>
                {clock === null && <Fault>missing</Fault>}
              </Link>
            </li>
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
          This is the identity, the clock and the roster themselves — there is no copy in code. A change
          reaches the next slot produced; what&rsquo;s already kept keeps its own.
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
      ) : showClock ? (
        <ClockEditor
          key={clockRow?.updatedAt.toISOString() ?? "missing"}
          value={clock}
          updatedAt={clockRow?.updatedAt.toISOString() ?? null}
        />
      ) : (
        <IdentityEditor
          key={identityRow?.updatedAt.toISOString() ?? "missing"}
          value={identity}
          updatedAt={identityRow?.updatedAt.toISOString() ?? null}
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
