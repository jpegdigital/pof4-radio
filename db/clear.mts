/** `pnpm db:clear` — wipe every session with its segments and slots (dev/test cleanup; nothing else). Cards stay: a record's card belongs to the record. */
import { Pool } from "pg";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set (run through `op run`, see .env.op)");
const pool = new Pool({ connectionString: url });
const sessions = await pool.query("delete from session");
console.log(`deleted ${sessions.rowCount} sessions (and their segments and slots)`);
await pool.end();
