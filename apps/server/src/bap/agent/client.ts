/**
 * HTTP client the agent's tools use to reach the BAP API over loopback with the CUSTOMER's token.
 * An explicit allowlist is the guardrail (PRD AGT-07): there is no entry for approve or pay, so the
 * agent cannot reach them whatever the model asks for.
 */

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

const SEG = "[^/?#]+";
const ALLOWED: ReadonlyArray<readonly [HttpMethod, RegExp]> = [
  ["GET", /^\/bap\/search$/],
  ["POST", /^\/bap\/plan$/],
  ["GET", /^\/bap\/basket$/],
  ["PUT", /^\/bap\/basket$/],
  ["PUT", /^\/bap\/basket\/items$/],
  ["PATCH", new RegExp(`^/bap/basket/items/${SEG}$`)],
  ["DELETE", new RegExp(`^/bap/basket/items/${SEG}$`)],
  ["POST", /^\/bap\/basket\/quote$/],
  ["GET", /^\/bap\/orders$/],
  ["GET", new RegExp(`^/bap/baskets/${SEG}$`)],
];

export class ToolForbiddenError extends Error {
  constructor(method: string, path: string) {
    super(`tool_forbidden: ${method} ${path}`);
  }
}

/** True when the agent may call this method + path (query string ignored, traversal rejected). */
export function isAllowedRoute(method: string, path: string): boolean {
  const pathname = path.split("?")[0] ?? "";
  if (!pathname.startsWith("/bap/") || /\.\.|%2e|%2f|\/\/|\\/i.test(pathname)) return false;
  return ALLOWED.some(([m, re]) => m === method.toUpperCase() && re.test(pathname));
}

export interface ToolResponse {
  status: number;
  body: unknown;
}

export interface ToolClient {
  call(method: HttpMethod, path: string, body?: unknown): Promise<ToolResponse>;
}

export function makeToolClient(opts: {
  baseUrl: string;
  token: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}): ToolClient {
  const doFetch = opts.fetchImpl ?? fetch;
  const base = opts.baseUrl.replace(/\/$/, "");
  return {
    async call(method, path, body) {
      if (!isAllowedRoute(method, path)) throw new ToolForbiddenError(method, path);
      const headers: Record<string, string> = { authorization: `Bearer ${opts.token}` };
      if (body !== undefined) headers["content-type"] = "application/json";
      const res = await doFetch(`${base}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: opts.signal,
      });
      const json: unknown = await res.json().catch(() => null);
      return { status: res.status, body: json };
    },
  };
}
