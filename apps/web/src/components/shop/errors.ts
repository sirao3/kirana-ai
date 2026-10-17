import { ApiError } from "../../lib/api";

/** Human message for a failed API call. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message && err.message !== err.code ? err.message : err.code.replace(/_/g, " ");
  if (err instanceof Error) return err.name === "TimeoutError" || err.name === "AbortError" ? "The request timed out." : err.message;
  return "Something went wrong.";
}

/** True when a failure means the assistant (not the whole shop) is unavailable: 503, timeout, network. */
export function isAgentDown(err: unknown): boolean {
  if (err instanceof ApiError) return err.status === 503 || err.status >= 500;
  return true;
}
