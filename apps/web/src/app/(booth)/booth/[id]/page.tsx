import { BoothView } from "./booth-view";

export const dynamic = "force-dynamic";

/** The session as a DJ set: the same show and transport as /sessions/:id, a different room. */
export default async function BoothPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <BoothView key={id} id={id} />;
}
