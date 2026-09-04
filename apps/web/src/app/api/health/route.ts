import { pool } from "@/lib/db";

/** Railway healthcheck target. Confirms the web process can reach Postgres. */
export async function GET() {
  try {
    await pool().query("select 1");
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ ok: false, error: String(err) }, { status: 503 });
  }
}
