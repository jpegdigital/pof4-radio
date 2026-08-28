import { createDb, type Db } from "@radio/db";
import { env } from "./env";

// One pool per server process (survives HMR in dev via globalThis).
const g = globalThis as unknown as { __db?: Db };

export function db(): Db {
  g.__db ??= createDb(env().DATABASE_URL);
  return g.__db;
}
