import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z, type ZodRawShape } from "zod";
import type { Config } from "./config.js";
import { CoolifyClient, CoolifyError } from "./client.js";
import { listEndpoints, getEndpoint, specInfo } from "./openapi.js";

type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

function text(value: unknown): ToolResult {
  const body =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: "text", text: body }] };
}

function fail(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

const CONFIRM_SHAPE = {
  confirm: z
    .boolean()
    .optional()
    .describe(
      "Safety switch. Must be explicitly true for the action to run. " +
        "If missing or false, only a preview of what would happen is returned.",
    ),
};

export function buildServer(cfg: Config): McpServer {
  const client = new CoolifyClient(cfg);

  const server = new McpServer({
    name: "coolify-mcp",
    version: "0.2.0",
  });

  /** Register a read-only tool. */
  function readTool<S extends ZodRawShape>(
    name: string,
    description: string,
    inputSchema: S,
    handler: (args: z.infer<z.ZodObject<S>>) => Promise<unknown>,
  ) {
    server.registerTool(
      name,
      {
        description,
        inputSchema,
        annotations: { readOnlyHint: true, openWorldHint: true },
      },
      (async (args: any) => {
        try {
          return text(await handler(args));
        } catch (err) {
          return fail(describeError(err));
        }
      }) as any,
    );
  }

  /**
   * Register a mutating tool. Execution is gated twice:
   *  1. COOLIFY_ALLOW_MUTATIONS=false disables it entirely.
   *  2. The caller must pass confirm:true; otherwise a preview is returned.
   */
  function writeTool<S extends ZodRawShape>(
    name: string,
    description: string,
    inputSchema: S,
    opts: { destructive?: boolean; preview: (args: any) => string },
    handler: (args: z.infer<z.ZodObject<S>>) => Promise<unknown>,
  ) {
    server.registerTool(
      name,
      {
        description:
          description +
          "\n\nWrite action: requires confirm:true. Without confirm, only a preview is returned.",
        inputSchema: { ...inputSchema, ...CONFIRM_SHAPE },
        annotations: {
          readOnlyHint: false,
          destructiveHint: opts.destructive ?? true,
          openWorldHint: true,
        },
      },
      (async (args: any) => {
        if (!cfg.allowMutations) {
          return fail(
            "Write/deploy is disabled (COOLIFY_ALLOW_MUTATIONS=false). " +
              "This server is running in read-only mode.",
          );
        }
        if (args?.confirm !== true) {
          return text(
            `PREVIEW (not executed) — ${opts.preview(args)}\n\n` +
              `To execute, repeat the same call with confirm:true.`,
          );
        }
        try {
          return text(await handler(args));
        } catch (err) {
          return fail(describeError(err));
        }
      }) as any,
    );
  }

  // ===========================================================================
  // READ — Instance / Meta
  // ===========================================================================
  readTool("coolify_version", "Returns the version of the Coolify instance.", {}, () =>
    client.get("/version"),
  );
  readTool(
    "coolify_health",
    "Healthcheck of the Coolify API (typically returns 'OK').",
    {},
    () => client.get("/health"),
  );
  readTool(
    "list_teams",
    "Lists all teams the token has access to.",
    {},
    () => client.get("/teams"),
  );
  readTool(
    "get_current_team",
    "Returns the team of the currently used API token.",
    {},
    () => client.get("/teams/current"),
  );
  readTool(
    "list_private_keys",
    "Lists the SSH private keys stored in Coolify. Secret key material is redacted " +
      "by the server (see the global redaction), so only metadata, fingerprints and " +
      "public keys reach the model.",
    {},
    () => client.get("/security/keys"),
  );

  // ===========================================================================
  // READ — Projects / Servers / Resources
  // ===========================================================================
  readTool("list_projects", "Lists all projects.", {}, () => client.get("/projects"));
  readTool(
    "get_project",
    "Fetches a project by its UUID (including environments).",
    { uuid: z.string().describe("Project UUID") },
    (a) => client.get(`/projects/${a.uuid}`),
  );
  readTool("list_servers", "Lists all connected servers.", {}, () =>
    client.get("/servers"),
  );
  readTool(
    "get_server",
    "Fetches a server by its UUID.",
    { uuid: z.string().describe("Server UUID") },
    (a) => client.get(`/servers/${a.uuid}`),
  );
  readTool(
    "get_server_resources",
    "Lists all resources (apps/DBs/services) running on a server.",
    { uuid: z.string().describe("Server UUID") },
    (a) => client.get(`/servers/${a.uuid}/resources`),
  );
  readTool(
    "list_resources",
    "Lists ALL resources across every project/server (full overview).",
    {},
    () => client.get("/resources"),
  );

  // ===========================================================================
  // READ — Applications
  // ===========================================================================
  readTool("list_applications", "Lists all applications.", {}, () =>
    client.get("/applications"),
  );
  readTool(
    "get_application",
    "Fetches an application by its UUID (configuration & status).",
    { uuid: z.string().describe("Application UUID") },
    (a) => client.get(`/applications/${a.uuid}`),
  );
  readTool(
    "list_application_envs",
    "Lists the environment variables of an application.",
    { uuid: z.string().describe("Application UUID") },
    (a) => client.get(`/applications/${a.uuid}/envs`),
  );

  // ===========================================================================
  // READ — Databases / Services / Deployments
  // ===========================================================================
  readTool("list_databases", "Lists all databases.", {}, () =>
    client.get("/databases"),
  );
  readTool(
    "get_database",
    "Fetches a database by its UUID.",
    { uuid: z.string().describe("Database UUID") },
    (a) => client.get(`/databases/${a.uuid}`),
  );
  readTool("list_services", "Lists all services.", {}, () => client.get("/services"));
  readTool(
    "get_service",
    "Fetches a service by its UUID.",
    { uuid: z.string().describe("Service UUID") },
    (a) => client.get(`/services/${a.uuid}`),
  );
  readTool(
    "list_deployments",
    "Lists currently running / most recent deployments.",
    {},
    () => client.get("/deployments"),
  );
  readTool(
    "get_deployment",
    "Fetches a deployment by its UUID (status & log metadata).",
    { uuid: z.string().describe("Deployment UUID") },
    (a) => client.get(`/deployments/${a.uuid}`),
  );

  // ===========================================================================
  // WRITE / DEPLOY — Application lifecycle
  // ===========================================================================
  writeTool(
    "deploy_application",
    "Triggers a deployment of an existing application (build & redeploy).",
    {
      uuid: z
        .string()
        .describe("Application UUID (multiple comma-separated allowed) or a deploy tag."),
      force: z
        .boolean()
        .optional()
        .describe("true forces a rebuild without cache. Default: false."),
    },
    {
      destructive: false,
      preview: (a) =>
        `Start deployment for '${a.uuid}'${a.force ? " (force rebuild)" : ""}.`,
    },
    (a) => client.get("/deploy", { uuid: a.uuid, force: a.force }),
  );
  writeTool(
    "start_application",
    "Starts a stopped application.",
    { uuid: z.string().describe("Application UUID") },
    { destructive: false, preview: (a) => `Start application '${a.uuid}'.` },
    (a) => client.get(`/applications/${a.uuid}/start`),
  );
  writeTool(
    "stop_application",
    "Stops a running application (causes downtime).",
    { uuid: z.string().describe("Application UUID") },
    { destructive: true, preview: (a) => `STOP application '${a.uuid}' (downtime).` },
    (a) => client.get(`/applications/${a.uuid}/stop`),
  );
  writeTool(
    "restart_application",
    "Restarts an application (brief downtime).",
    { uuid: z.string().describe("Application UUID") },
    { destructive: true, preview: (a) => `Restart application '${a.uuid}'.` },
    (a) => client.get(`/applications/${a.uuid}/restart`),
  );
  writeTool(
    "update_application",
    "Updates an application's configuration (PATCH). Only the provided fields are changed.",
    {
      uuid: z.string().describe("Application UUID"),
      settings: z
        .record(z.string(), z.any())
        .describe(
          "Fields to change, e.g. { git_branch, ports_exposes, build_pack, instant_deploy, ... }.",
        ),
    },
    {
      destructive: true,
      preview: (a) =>
        `Update application '${a.uuid}' with fields: ${Object.keys(a.settings ?? {}).join(", ") || "(none)"}.`,
    },
    (a) => client.patch(`/applications/${a.uuid}`, a.settings),
  );
  writeTool(
    "delete_application",
    "Permanently deletes an application.",
    { uuid: z.string().describe("Application UUID") },
    { destructive: true, preview: (a) => `IRREVERSIBLY delete application '${a.uuid}'.` },
    (a) => client.delete(`/applications/${a.uuid}`),
  );

  // ===========================================================================
  // WRITE — Application environment variables
  // ===========================================================================
  writeTool(
    "create_application_env",
    "Creates a new environment variable for an application.",
    {
      uuid: z.string().describe("Application UUID"),
      key: z.string().describe("Variable name"),
      value: z.string().describe("Variable value"),
      is_preview: z.boolean().optional().describe("Only for preview deployments."),
      is_build_time: z.boolean().optional().describe("Also make available at build time."),
    },
    {
      destructive: false,
      preview: (a) => `Create env '${a.key}' on application '${a.uuid}'.`,
    },
    (a) =>
      client.post(`/applications/${a.uuid}/envs`, {
        key: a.key,
        value: a.value,
        is_preview: a.is_preview,
        is_build_time: a.is_build_time,
      }),
  );
  writeTool(
    "update_application_env",
    "Updates an existing environment variable of an application (by key).",
    {
      uuid: z.string().describe("Application UUID"),
      key: z.string().describe("Name of the variable to change"),
      value: z.string().describe("New value"),
      is_preview: z.boolean().optional(),
      is_build_time: z.boolean().optional(),
    },
    {
      destructive: true,
      preview: (a) => `Update env '${a.key}' of application '${a.uuid}'.`,
    },
    (a) =>
      client.patch(`/applications/${a.uuid}/envs`, {
        key: a.key,
        value: a.value,
        is_preview: a.is_preview,
        is_build_time: a.is_build_time,
      }),
  );
  writeTool(
    "delete_application_env",
    "Deletes an application's environment variable by its env UUID.",
    {
      uuid: z.string().describe("Application UUID"),
      env_uuid: z.string().describe("UUID of the environment variable (from list_application_envs)"),
    },
    {
      destructive: true,
      preview: (a) => `Delete env '${a.env_uuid}' of application '${a.uuid}'.`,
    },
    (a) => client.delete(`/applications/${a.uuid}/envs/${a.env_uuid}`),
  );

  // ===========================================================================
  // WRITE — Service & database lifecycle
  // ===========================================================================
  for (const action of ["start", "stop", "restart"] as const) {
    const destructive = action !== "start";
    const verb = action === "start" ? "Starts" : action === "stop" ? "Stops" : "Restarts";
    writeTool(
      `${action}_service`,
      `${verb} a service.`,
      { uuid: z.string().describe("Service UUID") },
      { destructive, preview: (a) => `Service '${a.uuid}': ${action}.` },
      (a) => client.get(`/services/${a.uuid}/${action}`),
    );
    writeTool(
      `${action}_database`,
      `${verb} a database.`,
      { uuid: z.string().describe("Database UUID") },
      { destructive, preview: (a) => `Database '${a.uuid}': ${action}.` },
      (a) => client.get(`/databases/${a.uuid}/${action}`),
    );
  }

  // ===========================================================================
  // WRITE — Create application (most common variants)
  // ===========================================================================
  writeTool(
    "create_application_public",
    "Creates an application from a public Git repository.",
    {
      project_uuid: z.string().describe("Target project UUID"),
      server_uuid: z.string().describe("Target server UUID"),
      environment_name: z.string().describe("Environment name, e.g. 'production'"),
      git_repository: z.string().describe("URL of the public repo"),
      git_branch: z.string().describe("Branch, e.g. 'main'"),
      build_pack: z
        .enum(["nixpacks", "static", "dockerfile", "dockercompose"])
        .describe("Build pack type"),
      ports_exposes: z.string().describe("Exposed ports, e.g. '3000'"),
      extra: z
        .record(z.string(), z.any())
        .optional()
        .describe("Further optional fields per the Coolify API (e.g. instant_deploy, name)."),
    },
    {
      destructive: false,
      preview: (a) =>
        `Create new application from ${a.git_repository}@${a.git_branch} in project '${a.project_uuid}'.`,
    },
    (a) => {
      const { extra, ...rest } = a as any;
      delete rest.confirm;
      return client.post("/applications/public", { ...rest, ...(extra ?? {}) });
    },
  );
  writeTool(
    "create_application_dockerimage",
    "Creates an application from a prebuilt Docker image.",
    {
      project_uuid: z.string().describe("Target project UUID"),
      server_uuid: z.string().describe("Target server UUID"),
      environment_name: z.string().describe("Environment name, e.g. 'production'"),
      docker_registry_image_name: z.string().describe("Image name, e.g. 'nginx'"),
      docker_registry_image_tag: z.string().optional().describe("Tag, e.g. 'latest'"),
      ports_exposes: z.string().describe("Exposed ports, e.g. '80'"),
      extra: z.record(z.string(), z.any()).optional().describe("Further optional fields per the Coolify API."),
    },
    {
      destructive: false,
      preview: (a) =>
        `Create new application from image '${a.docker_registry_image_name}:${a.docker_registry_image_tag ?? "latest"}'.`,
    },
    (a) => {
      const { extra, ...rest } = a as any;
      delete rest.confirm;
      return client.post("/applications/dockerimage", { ...rest, ...(extra ?? {}) });
    },
  );

  // ===========================================================================
  // API DOCS — let the LLM look up endpoints before free-form calls
  // ===========================================================================
  readTool(
    "coolify_api_overview",
    "Reads the bundled Coolify OpenAPI documentation: returns a compact list of all " +
      "API endpoints (METHOD, path, tag, summary). Optionally filter by a substring " +
      "(matches path, summary, tag or operationId). Use this to discover which endpoint " +
      "to call via coolify_get / coolify_mutate, then look up its fields with " +
      "coolify_api_endpoint.",
    {
      filter: z
        .string()
        .optional()
        .describe("Case-insensitive substring, e.g. 'database', 'project', 'envs'."),
    },
    async (a) => ({ info: specInfo(), endpoints: listEndpoints(a.filter) }),
  );
  readTool(
    "coolify_api_endpoint",
    "Reads the full documentation for one Coolify API endpoint: parameters and the " +
      "request-body schema (with concrete field names, types and which are required), " +
      "plus the possible response codes. Use this right before calling coolify_get / " +
      "coolify_mutate so the path and body are correct.",
    {
      path: z.string().describe("Exact path from coolify_api_overview, e.g. '/databases/postgresql'"),
      method: z
        .enum(["GET", "POST", "PATCH", "PUT", "DELETE"])
        .optional()
        .describe("Disambiguates when a path defines multiple methods. Optional."),
    },
    async (a) => getEndpoint(a.path, a.method),
  );

  // ===========================================================================
  // ESCAPE HATCHES — arbitrary API paths (full API coverage)
  // ===========================================================================
  readTool(
    "coolify_get",
    "Generic read access: performs a GET against an arbitrary Coolify API path " +
      "(relative to /api/v1). Reaches every read endpoint, including those without a " +
      "dedicated tool. Discover paths with coolify_api_overview / coolify_api_endpoint.",
    {
      path: z.string().describe("Path relative to /api/v1, e.g. '/applications' or '/servers/<uuid>'"),
      query: z
        .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
        .optional()
        .describe("Optional query parameters."),
    },
    (a) => client.get(a.path, a.query),
  );
  writeTool(
    "coolify_mutate",
    "Generic write operation: POST/PATCH/PUT/DELETE against an arbitrary Coolify API path " +
      "(relative to /api/v1). Reaches every write endpoint, including those without a " +
      "dedicated tool. Look up the exact path and body fields with coolify_api_endpoint first.",
    {
      method: z.enum(["POST", "PATCH", "PUT", "DELETE"]).describe("HTTP method"),
      path: z.string().describe("Path relative to /api/v1"),
      body: z.record(z.string(), z.any()).optional().describe("JSON request body"),
    },
    {
      destructive: true,
      preview: (a) => `${a.method} ${a.path} with body keys: ${Object.keys(a.body ?? {}).join(", ") || "(empty)"}.`,
    },
    (a) => client.request(a.method, a.path, { body: a.body }),
  );

  return server;
}

function describeError(err: unknown): string {
  if (err instanceof CoolifyError) {
    const body = typeof err.body === "string" ? err.body : JSON.stringify(err.body, null, 2);
    // status 0 means a network/timeout failure, not an HTTP response code.
    if (err.status === 0) return `Coolify request failed: ${body}`;
    return `Coolify error (HTTP ${err.status}): ${body}`;
  }
  return `Unexpected error: ${err instanceof Error ? err.message : String(err)}`;
}
