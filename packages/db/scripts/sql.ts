/**
 * `pnpm db:sql "<query>"` — run one read-only statement against the live DB and print the
 * rows. For looking at a failed call's frozen prompt, a book's pages, etc. without opening a
 * SQL client (each `op run` is a 1Password prompt, so one query per prompt beats ad-hoc
 * scripts). Runs inside a transaction that is always rolled back.
 */
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set (run through `op run`, see .env.op)");
const sql = process.argv.slice(2).join(" ").trim();
if (!sql) throw new Error('usage: pnpm db:sql "select ..."');

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query("begin read only");
  const { rows } = await client.query(sql);
  console.log(JSON.stringify(rows, null, 2));
} finally {
  await client.query("rollback").catch(() => {});
  await client.end();
}
