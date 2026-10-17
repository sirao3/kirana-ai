import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Config } from "../config.js";

/** Demo persona tokens (PRD §2): HMAC-signed, no passwords. */
export type Role = "customer" | "merchant" | "admin";
export interface AuthClaims {
  role: Role;
  /** customer id, store id, or "admin". */
  sub: string;
  iat: number;
}

declare module "fastify" {
  interface FastifyRequest {
    auth?: AuthClaims;
  }
}

export function authSecret(config: Config): string {
  return config.AUTH_SECRET ?? createHash("sha256").update(`kiranaai:${config.ADMIN_PASSCODE}`).digest("hex");
}

const b64 = (s: string) => Buffer.from(s).toString("base64url");
const sign = (secret: string, payload: string) => createHmac("sha256", secret).update(payload).digest("base64url");

export function signToken(secret: string, claims: Omit<AuthClaims, "iat">): string {
  const payload = b64(JSON.stringify({ ...claims, iat: Math.floor(Date.now() / 1000) }));
  return `${payload}.${sign(secret, payload)}`;
}

export function verifyToken(secret: string, token: string): AuthClaims | null {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = Buffer.from(sign(secret, payload));
  const got = Buffer.from(sig);
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null;
  try {
    const c = JSON.parse(Buffer.from(payload, "base64url").toString()) as AuthClaims;
    return ["customer", "merchant", "admin"].includes(c.role) && typeof c.sub === "string" ? c : null;
  } catch {
    return null;
  }
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * preHandler: requires `Authorization: Bearer <token>` with one of `roles`; sets req.auth.
 *   app.get("/x", { preHandler: requireAuth("customer") }, handler)
 */
export function requireAuth(...roles: Role[]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const h = req.headers.authorization;
    const claims = h?.startsWith("Bearer ") ? verifyToken(authSecret(req.server.ctx.config), h.slice(7)) : null;
    if (!claims) return reply.code(401).send({ error: "unauthorized" });
    if (roles.length && !roles.includes(claims.role)) return reply.code(403).send({ error: "forbidden" });
    req.auth = claims;
  };
}

/** Merchant routes: the store's own token, or admin (the demo wall acts for every store). */
export function canActForStore(auth: AuthClaims | undefined, storeId: string): boolean {
  return !!auth && (auth.role === "admin" || (auth.role === "merchant" && auth.sub === storeId));
}
