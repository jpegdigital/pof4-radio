import { ZodError, z } from "zod";
import { env } from "@/lib/env";

/**
 * The Node half of `instrumentation.ts`, apart so the edge bundle never sees `process.exit`. Next
 * logs a thrown `register` and keeps a server that answers 500 to everything, health included —
 * so an incomplete environment exits the process and the platform sees a failed deploy.
 */
try {
  env();
} catch (err) {
  if (!(err instanceof ZodError)) throw err;
  console.error(`radio-web cannot start, the environment is incomplete:\n${z.prettifyError(err)}`);
  process.exit(1);
}
