import pg from "pg";
import { env } from "./env";

/**
 * One Postgres pool per server process (survives HMR in dev via globalThis). Plain SQL over an
 * ORM — readable queries, owned by the store for their tables (the show's: session, session_slot,
 * track, in `api/sessions/show-store.ts`), not scattered through the routes.
 */
const g = globalThis as unknown as { __pool?: pg.Pool };

export function pool(): pg.Pool {
  g.__pool ??= new pg.Pool({ connectionString: env().DATABASE_URL, max: 5 });
  return g.__pool;
}
