import pg from "pg";
import { env } from "./env";

/**
 * One Postgres pool per server process (survives HMR in dev via globalThis). Queries are plain
 * SQL at the call site — no query layer: a route reads like the request it serves.
 */
const g = globalThis as unknown as { __pool?: pg.Pool };

export function pool(): pg.Pool {
  g.__pool ??= new pg.Pool({ connectionString: env().DATABASE_URL, max: 5 });
  return g.__pool;
}
