import { z } from "zod";

const Env = z.object({
  PORT: z.coerce.number().int().default(8080),
  SELF_BASE_URL: z.string().url().optional(),
  // Either a full URL (local/tests) or discrete parts (Cloud Run → VM over the VPC).
  DATABASE_URL: z.string().optional(),
  DB_HOST: z.string().default("127.0.0.1"),
  DB_PORT: z.coerce.number().int().default(5432),
  DB_NAME: z.string().default("kiranaai"),
  DB_USER: z.string().default("kiranaai"),
  DB_PASSWORD: z.string().default(""),
  ADMIN_PASSCODE: z.string().default("demo"),
  /** Signs persona tokens; defaults to a hash of ADMIN_PASSCODE. */
  AUTH_SECRET: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default("gemini-3.5-flash"),
  AGENT_DAILY_CAP: z.coerce.number().int().positive().default(500),
  OFFER_WINDOW_SECONDS: z.coerce.number().int().positive().default(45),
  WEB_DIST: z.string().optional(),
  LOG_LEVEL: z.string().default("info"),
});

export type Config = z.infer<typeof Env> & { selfBaseUrl: string; databaseUrl: string };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const c = Env.parse(env);
  const databaseUrl =
    c.DATABASE_URL ??
    `postgres://${encodeURIComponent(c.DB_USER)}:${encodeURIComponent(c.DB_PASSWORD)}@${c.DB_HOST}:${c.DB_PORT}/${c.DB_NAME}`;
  return { ...c, selfBaseUrl: c.SELF_BASE_URL ?? `http://127.0.0.1:${c.PORT}`, databaseUrl };
}
