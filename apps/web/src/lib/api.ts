import { getSession } from "./session";

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message?: string, readonly details?: unknown) {
    super(message ?? code);
  }
}

/** JSON fetch against this origin with the session token. Throws ApiError on non-2xx. */
export async function api<T>(path: string, init: RequestInit & { json?: unknown; token?: string } = {}): Promise<T> {
  const token = init.token ?? getSession()?.token;
  const headers = new Headers(init.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (init.json !== undefined) headers.set("content-type", "application/json");
  const res = await fetch(path, { ...init, headers, body: init.json !== undefined ? JSON.stringify(init.json) : init.body });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const b = (body ?? {}) as { error?: string; message?: string; details?: unknown };
    throw new ApiError(res.status, b.error ?? `http_${res.status}`, b.message, b.details);
  }
  return body as T;
}
