export class UserInputError extends Error {
  override readonly name = "UserInputError";
}

export class UpstreamError extends Error {
  override readonly name = "UpstreamError";

  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}
