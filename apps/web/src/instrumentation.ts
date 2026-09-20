/**
 * Read once as the server starts, before it takes a request: a deploy missing a required variable
 * stops here, naming it (`lib/env`), rather than failing a listener mid-show. Node only: the
 * proxy's edge runtime has no use for the server's env.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") await import("./instrumentation-node");
}
