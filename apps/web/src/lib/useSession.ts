import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { getSession, type Session } from "./session";

/** Returns the session for `role`, or redirects to the persona picker at `/` and returns null. */
export function useRequireSession(role: Session["role"]): Session | null {
  const nav = useNavigate();
  const s = getSession();
  const ok = s && s.role === role ? s : null;
  useEffect(() => {
    if (!ok) nav("/", { replace: true });
  }, [ok, nav]);
  return ok;
}
