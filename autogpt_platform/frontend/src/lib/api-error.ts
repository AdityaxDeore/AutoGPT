import { GraphValidationErrorResponse } from "@/lib/autogpt-server-api/types";

export class ApiError<R = any> extends Error {
  public status: number;
  public response: R;

  constructor(message: string, status: number, response: R) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.response = response;
  }

  /**
   * Type guard to check if this error is a structured graph validation error
   */
  isGraphValidationError(): this is ApiError<GraphValidationErrorResponse> {
    return (
      this.response !== undefined &&
      typeof this.response === "object" &&
      this.response !== null &&
      "detail" in this.response &&
      typeof this.response.detail === "object" &&
      this.response.detail !== null &&
      "type" in this.response.detail &&
      this.response.detail.type === "validation_error" &&
      "node_errors" in this.response.detail &&
      typeof this.response.detail.node_errors === "object"
    );
  }
}

export const AUTH_TOKEN_UNAVAILABLE = "auth_token_unavailable";

/**
 * A signed-in request whose backend token could not be minted, because the
 * auth database refused or timed out. Unlike a missing or expired session it
 * is not "signed out": the request fails with a retryable 503 instead of
 * reaching the backend without a token, whose 401 would read as a logout.
 */
export class AuthTokenUnavailableError extends ApiError<{
  detail: string;
  code: typeof AUTH_TOKEN_UNAVAILABLE;
}> {
  constructor(options?: { cause?: unknown }) {
    const message = "Could not verify your sign-in. Try again in a moment.";
    super(message, 503, { detail: message, code: AUTH_TOKEN_UNAVAILABLE });
    this.name = "AuthTokenUnavailableError";
    this.cause = options?.cause;
  }
}
