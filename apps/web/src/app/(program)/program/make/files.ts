import { mkdir, readdir, readFile, stat as fsStat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { z } from "zod";

/**
 * The maker's directory: `public/program/make/` under the app, where every stage reads its input
 * and writes its output. Files, not rows — readable, hand-editable, gitignored.
 */
export const MAKE_DIR = path.join(process.cwd(), "public", "program", "make");

/** A stage failure with the status the route answers with. */
export class MakeError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const file = (name: string) => path.join(MAKE_DIR, name);

/** The file's mtime as an ISO string, or null when it isn't there. */
export async function stat(name: string): Promise<string | null> {
  return fsStat(file(name)).then(
    (s) => s.mtime.toISOString(),
    () => null,
  );
}

export const exists = async (name: string): Promise<boolean> => (await stat(name)) !== null;

/** Read and validate a stage file: 409 when missing, 400 (naming the file and the path) when malformed. */
export async function readJson<S extends z.ZodType>(name: string, schema: S): Promise<z.infer<S>> {
  let text: string;
  try {
    text = await readFile(file(name), "utf8");
  } catch {
    throw new MakeError(409, `missing: ${name}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new MakeError(400, `${name}: ${e instanceof Error ? e.message : "not JSON"}`);
  }
  const r = schema.safeParse(json);
  if (!r.success) {
    const issue = r.error.issues[0];
    const where =
      issue?.path
        .map((p) => (typeof p === "number" ? `[${p}]` : `.${String(p)}`))
        .join("")
        .replace(/^\./, "") ?? "";
    throw new MakeError(400, `${name}: ${where || "(root)"} — ${issue?.message ?? "invalid"}`);
  }
  return r.data;
}

/** Read a file if it exists and validates; null otherwise (a cache read, never an error). */
export async function readJsonIfValid<S extends z.ZodType>(
  name: string,
  schema: S,
): Promise<z.infer<S> | null> {
  try {
    return await readJson(name, schema);
  } catch {
    return null;
  }
}

export async function writeJson(name: string, value: unknown): Promise<void> {
  const p = file(name);
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, `${JSON.stringify(value, null, 2)}\n`);
}

export async function writeClip(name: string, bytes: Uint8Array): Promise<void> {
  const p = file(name);
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, bytes);
}

export async function remove(name: string): Promise<void> {
  await unlink(file(name)).catch(() => {});
}

/** The ids of the cards on disk. */
export async function listCards(): Promise<string[]> {
  const names = await readdir(file("cards")).catch(() => [] as string[]);
  return names.filter((n) => n.endsWith(".json")).map((n) => n.slice(0, -5));
}

/** Read a JSON file anywhere under `public/` (the sweepers' manifest lives beside the maker). */
export async function readPublicJson(rel: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path.join(process.cwd(), "public", rel), "utf8"));
  } catch {
    return null;
  }
}
