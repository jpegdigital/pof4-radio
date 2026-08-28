/** `pnpm db:clear` — wipe every station and its segments (dev/test cleanup; nothing else). */
import { Pool } from "pg";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set (run through `op run`, see .env.op)");
const pool = new Pool({ connectionString: url });
const segs = await pool.query("delete from segment");
const stations = await pool.query("delete from station");
console.log(`deleted ${stations.rowCount} stations, ${segs.rowCount} segments`);
await pool.end();
