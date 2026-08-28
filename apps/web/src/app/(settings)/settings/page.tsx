import type { Metadata } from "next";
import Link from "next/link";
import { DEFAULT_PROMPTS, PROMPT_SLOTS, type PromptKey } from "@radio/dj";
import { db } from "@/lib/db";
import { PromptEditor } from "./prompt-editor";

export const metadata: Metadata = { title: "Settings · Radio" };
export const dynamic = "force-dynamic";

/**
 * /settings — the DJ's script, one slot at a time. A rail of slots on the left, chosen by
 * `?slot=` so the page stays a Server Component; the editor for that slot on the right.
 * A slot with a `settings` row is edited (the lamp is on); without one it reads its default
 * from code. Saving applies to the next segment planned.
 */
const isKey = (s: unknown): s is PromptKey => PROMPT_SLOTS.some((p) => p.key === s);

export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  const [{ slot: requested }, rows] = await Promise.all([searchParams, db().listSettings()]);
  const key: PromptKey = isKey(requested) ? requested : PROMPT_SLOTS[0].key;
  const slot = PROMPT_SLOTS.find((s) => s.key === key)!;
  const edited = new Map(rows.map((r) => [r.key, r]));
  const row = edited.get(key);

  return (
    <div className="grid items-start gap-8 md:grid-cols-[14rem_minmax(0,1fr)] md:gap-12">
      <nav aria-label="Prompt slots" className="md:sticky md:top-8">
        <p className="mb-3 font-display text-sm uppercase tracking-[0.2em] text-zinc-500">DJ script</p>
        <ul className="-mx-5 flex gap-1 overflow-x-auto px-5 md:mx-0 md:flex-col md:overflow-visible md:px-0">
          {PROMPT_SLOTS.map((s) => {
            const active = s.key === key;
            const on = edited.has(s.key);
            return (
              <li key={s.key} className="shrink-0">
                <Link
                  href={`/settings?slot=${s.key}`}
                  aria-current={active ? "page" : undefined}
                  className={`flex min-h-10 items-center gap-3 whitespace-nowrap rounded-md px-3 text-sm transition ${
                    active
                      ? "bg-zinc-800 text-zinc-100"
                      : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
                  }`}
                >
                  <span
                    aria-hidden
                    className={`size-1.5 rounded-full ${on ? "bg-lamp shadow-[0_0_6px_var(--color-lamp)]" : "bg-zinc-700"}`}
                  />
                  <span className="flex-1">{s.label}</span>
                  <span className="font-display text-xs uppercase tracking-[0.15em] text-zinc-600">
                    {on ? "edited" : "default"}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
        <p className="mt-6 hidden text-xs leading-relaxed text-zinc-600 md:block">
          A lit slot is one you changed; the others read the defaults in code. Changes reach the next block
          the DJ plans — the one already buffered keeps its script.
        </p>
      </nav>

      <PromptEditor
        key={`${key}:${row?.updatedAt.toISOString() ?? "default"}`}
        slot={slot}
        value={row?.value ?? DEFAULT_PROMPTS[key]}
        defaultValue={DEFAULT_PROMPTS[key]}
        updatedAt={row?.updatedAt.toISOString() ?? null}
      />
    </div>
  );
}
