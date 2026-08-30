/** A production failure with the status the route answers with. */
export class ProducerError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
