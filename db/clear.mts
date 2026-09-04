/**
 * `pnpm db:clear` — wipe every session with its slots (dev/test cleanup; nothing else). Tracks
 * stay: a track belongs to the library. `pnpm db:clear --tracks` also wipes the track rows; the
 * bytes stay in the bucket, and a row comes back — with full tags and no download — the next time
 * a slot picks that track (the pull finds the bytes by HEAD).
 */
import { Pool } from "pg";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set (run through `op run`, see .env.op)");
const pool = new Pool({ connectionString: url });
const sessions = await pool.query("delete from session");
console.log(`deleted ${sessions.rowCount} sessions (and their slots)`);
if (process.argv.includes("--tracks")) {
  const tracks = await pool.query("delete from track");
  console.log(`deleted ${tracks.rowCount} track rows (the bytes stay in the bucket)`);
}
await pool.end();
