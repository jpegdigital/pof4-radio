import { SessionView } from "./session-view";

export const dynamic = "force-dynamic";

/** The session's home. The browser owns the state machine and the player. */
export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SessionView id={id} />;
}
