import { notFound } from "next/navigation";
import { loadVoices } from "@/lib/voices";
import { PROGRAM_START_MS } from "../manifest";
import { Maker } from "./maker";
import { DEFAULT_STATION } from "./shapes";

export const dynamic = "force-dynamic";

/**
 * The maker. The server contributes the roster's default voice (the DJ's name) and the station's
 * constants; the page runs the stages in the browser. Dev only, like the stage routes.
 */
export default async function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  const dj = (await loadVoices())[0]?.name ?? "";
  return <Maker dj={dj} station={DEFAULT_STATION} startMs={PROGRAM_START_MS} />;
}
