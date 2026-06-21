export interface Config {
  baseUrl: string;
  token: string;
  allowMutations: boolean;
  timeoutMs: number;
}

/**
 * Reads configuration from the process environment. The MCP client injects
 * these via its server "env" block, so the secret token never reaches the LLM.
 * For local testing, `node --env-file=.env` is loaded in index.ts.
 */
export function loadConfig(): Config {
  const baseUrlRaw = process.env.COOLIFY_BASE_URL?.trim();
  const token = process.env.COOLIFY_API_TOKEN?.trim();

  const missing: string[] = [];
  if (!baseUrlRaw) missing.push("COOLIFY_BASE_URL");
  if (!token) missing.push("COOLIFY_API_TOKEN");
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(", ")}. ` +
        `Copy .env.example to .env and fill in the values.`,
    );
  }

  const allowMutations =
    (process.env.COOLIFY_ALLOW_MUTATIONS ?? "true").trim().toLowerCase() !== "false";

  const timeoutMs = Number(process.env.COOLIFY_TIMEOUT_MS ?? "30000");

  return {
    baseUrl: baseUrlRaw!.replace(/\/+$/, ""),
    token: token!,
    allowMutations,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 30000,
  };
}
