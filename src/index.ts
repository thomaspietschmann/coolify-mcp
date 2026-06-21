#!/usr/bin/env node
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { buildServer } from "./server.js";

/**
 * Configuration comes from environment variables. In production these are
 * injected by the MCP client via the server's "env" block in the MCP config —
 * the API token therefore lives in the client config, never in the LLM context.
 *
 * As a convenience for local testing, an optional `.env` file in the working
 * directory is loaded if present. It is NOT required.
 */
function maybeLoadDotenv() {
  const envPath = resolve(process.cwd(), ".env");
  if (existsSync(envPath) && typeof process.loadEnvFile === "function") {
    try {
      process.loadEnvFile(envPath);
    } catch {
      // Ignore — env vars from the MCP config take precedence anyway.
    }
  }
}

async function main() {
  maybeLoadDotenv();

  const cfg = loadConfig();
  const server = buildServer(cfg);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // stdout is reserved for the MCP protocol; log to stderr only.
  console.error(
    `coolify-mcp running (stdio). Target: ${cfg.baseUrl} | Mutations: ${
      cfg.allowMutations ? "on (confirm required)" : "off (read-only)"
    }`,
  );
}

main().catch((err) => {
  console.error("Fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
