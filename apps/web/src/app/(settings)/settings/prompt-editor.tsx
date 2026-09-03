"use client";

import { fillVars, PROMPT_VAR_HELP, type PromptVar } from "@radio/dj";
import { Fragment, useActionState, useRef, useState } from "react";
import { type SaveState, savePrompt } from "./actions";

/**
 * One prompt slot: the script in a mono textarea, its placeholders as chips that drop into the
 * text at the caret, and — for slots that take placeholders — a preview of the same text as the
 * DJ will read it, with a sample block filled in and the substitutions lit up.
 */

interface Slot {
  key: string;
  label: string;
  blurb: string;
  vars: readonly PromptVar[];
}

/** A sample segment, for the preview: what each placeholder looks like filled. */
const SAMPLE: Record<PromptVar, string> = {
  request: "Saturday night 80s, Dallas, hits-forward, keep it warm",
  dj: "David Wolfe",
  identity: 'WFAI, Dallas — said on air as "56.6, Claude Radio"',
  clock: "8:43 pm",
  played: [
    "1. Duran Duran — Hungry Like the Wolf",
    "2. Prince — When Doves Cry",
    "3. Eurythmics — Sweet Dreams",
  ].join("\n"),
  record: 'Duran Duran — "Hungry Like the Wolf" (album: Rio; this version runs 221 s)',
  slot: "record 2 of 4",
  records: [
    "  1. Duran Duran — Hungry Like the Wolf (221 s)",
    "→ 2. Prince — When Doves Cry (351 s)  ← this slot",
    "  3. Eurythmics — Sweet Dreams (216 s)",
    "  4. Tears for Fears — Shout (390 s)",
  ].join("\n"),
  cards:
    "Prince — When Doves Cry: intro 12 s (unsure), the vocal comes in on the first verse, no count-in; ends fade; energy 4/5, mid-tempo; stark, electric. Talking points: no bass on the record · 1984",
  previous_words: [
    "WFAI, Dallas. 56.6, Claude Radio. It's eight forty-three, and this is the hour the neon comes on. Let's go.",
    "Duran Duran, Rio, and the single that put them on every wall in America.",
  ].join("\n\n"),
  legal_id: "WFAI, Dallas. 56.6, Claude Radio.",
  weather: [
    "Now (8:43 PM): Clear, 84°F, feels like 88, humidity 55%, wind 7 mph.",
    "Tonight: Mostly Clear, low around 74. Mostly clear, with a low around 74. South wind 5 to 10 mph.",
    "Saturday: Sunny, high near 97. Sunny, with a high near 97. Heat index values as high as 103.",
  ].join("\n"),
  headlines: [
    "Dallas: Grass fires burn along highways in Dallas and Denton counties (FOX 4 News Dallas-Fort Worth)",
    "Nation: Feminist activist Gloria Steinem dies at age 92 (Reuters)",
    "World: U.N. says world will miss its 1.5-degree climate target (nytimes.com)",
  ].join("\n"),
};

export function PromptEditor({
  slot,
  value,
  updatedAt,
}: {
  slot: Slot;
  value: string;
  updatedAt: string | null;
}) {
  const [text, setText] = useState(value);
  const area = useRef<HTMLTextAreaElement>(null);
  const [save, saveAction, saving] = useActionState<SaveState, FormData>(savePrompt, {});
  const dirty = text !== value;
  const missingRow = updatedAt === null;
  const missing = slot.vars.filter((v) => !text.includes(`{${v}}`));

  function insert(name: PromptVar) {
    const el = area.current;
    const token = `{${name}}`;
    if (!el) {
      setText((t) => t + token);
      return;
    }
    const start = el.selectionStart ?? text.length;
    const end = el.selectionEnd ?? start;
    const next = text.slice(0, start) + token + text.slice(end);
    setText(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  }

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-display text-sm uppercase tracking-[0.2em] text-zinc-500">
            {missingRow ? "No row in settings yet" : `Edited ${when(updatedAt)}`}
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{slot.label}</h1>
          <p className="mt-1 max-w-prose text-sm text-zinc-400">{slot.blurb}</p>
        </div>
        <p className="font-mono text-xs text-zinc-600">{slot.key}</p>
      </div>

      <form action={saveAction} className="flex flex-col gap-3">
        <input type="hidden" name="key" value={slot.key} />
        {slot.vars.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
            <span className="font-display text-sm uppercase tracking-[0.15em]">Placeholders</span>
            {slot.vars.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => insert(v)}
                title={`${PROMPT_VAR_HELP[v]} — click to insert at the cursor`}
                className="var-chip hover:bg-lamp/20"
              >
                {`{${v}}`}
              </button>
            ))}
          </div>
        )}
        <textarea
          ref={area}
          name="value"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={slot.vars.length ? 12 : 24}
          spellCheck={false}
          aria-label={`${slot.label} prompt`}
          className="w-full resize-y rounded-md border border-zinc-800 bg-zinc-900/60 px-4 py-3 font-mono text-[13px] leading-relaxed text-zinc-100 focus:border-zinc-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-lamp/60"
        />
        {missing.length > 0 && (
          <p className="text-xs text-zinc-500">
            Not used here: {missing.map((v) => `{${v}}`).join(", ")} — the DJ won&rsquo;t see it. That&rsquo;s
            allowed, but usually a mistake.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={!dirty || saving}
            className="rounded-md bg-zinc-100 px-4 py-2 text-sm font-medium text-black transition disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
          {dirty && !saving && (
            <button
              type="button"
              onClick={() => setText(value)}
              className="text-sm text-zinc-400 underline-offset-2 hover:underline"
            >
              Discard
            </button>
          )}
          {save.error && <span className="text-sm text-red-400">{save.error}</span>}
          {!dirty && save.savedAt && !save.error && (
            <span className="text-sm text-zinc-500">Saved — applies to the next segment.</span>
          )}
        </div>
      </form>

      {slot.vars.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="font-display text-sm uppercase tracking-[0.2em] text-zinc-500">
            As the DJ reads it · sample segment
          </h2>
          <Preview text={text} vars={slot.vars} />
        </section>
      )}
    </div>
  );
}

/** The filled text, with each substitution wrapped so it shows as lit. */
function Preview({ text, vars }: { text: string; vars: readonly PromptVar[] }) {
  const values = Object.fromEntries(vars.map((v) => [v, SAMPLE[v] ?? ""])) as Partial<
    Record<PromptVar, string>
  >;
  const pattern = new RegExp(`\\{(${vars.join("|")})\\}`, "g");
  const parts = text.split(pattern);
  return (
    <pre className="whitespace-pre-wrap rounded-md border border-zinc-800/70 bg-zinc-950 px-4 py-3 font-mono text-[13px] leading-relaxed text-zinc-300">
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <span key={i} className="var-filled">
            {fillVars(`{${p}}`, values)}
          </span>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </pre>
  );
}

function when(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
