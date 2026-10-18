import { existsSync, readFileSync } from "node:fs";
import { OAuth2Client } from "google-auth-library";
import { loadConfig } from "../../src/config.js";
import { geminiBackend, type GeminiBackend } from "../../src/bap/agent/gemini.js";

/**
 * Backend for the live smoke tests (undefined → skip): the server's own choice from the environment plus the root `.env`.
 * With GEMINI_VERTEX=1 it uses ADC, or GEMINI_ACCESS_TOKEN (`gcloud auth print-access-token`) when ADC is not set up.
 */
export function liveBackend(): GeminiBackend | undefined {
  const envFile = new URL("../../../../.env", import.meta.url);
  const fileEnv = existsSync(envFile)
    ? Object.fromEntries([...readFileSync(envFile, "utf8").matchAll(/^([A-Z_]+)=(.*)$/gm)].map((m) => [m[1]!, m[2]!.trim()]))
    : {};
  const backend = geminiBackend(loadConfig({ ...fileEnv, ...process.env }));
  if (!backend) return undefined;
  const token = process.env.GEMINI_ACCESS_TOKEN;
  if (backend.kind === "vertex" && token) {
    const authClient = new OAuth2Client();
    authClient.setCredentials({ access_token: token });
    backend.googleAuthOptions = { authClient };
  }
  return backend;
}
