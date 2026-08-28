/** `pnpm db:clear` — wipe every segment and its pg-boss jobs (dev/test cleanup; nothing else). */
import { Pool } from "pg";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set (run through `op run`, see .env.op)");
const pool = new Pool({ connectionString: url });
const jobs = await pool.query("delete from pgboss.job where name = 'segment'");
const segs = await pool.query("delete from segments");
console.log(`deleted ${segs.rowCount} segments, ${jobs.rowCount} jobs`);
await pool.end();
