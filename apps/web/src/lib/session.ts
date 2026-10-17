/** Persona token per tab (sessionStorage), so /shop and /wall can run side by side. */
export interface Session {
  token: string;
  role: "customer" | "merchant" | "admin";
  sub: string;
  name: string;
}

const KEY = "kiranaai.session";

export function getSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function setSession(s: Session | null): void {
  try {
    if (s) sessionStorage.setItem(KEY, JSON.stringify(s));
    else sessionStorage.removeItem(KEY);
  } catch {
    // storage blocked: the session lasts only for this page view
  }
}
