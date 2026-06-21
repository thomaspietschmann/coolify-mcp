import { readFileSync } from "node:fs";

/**
 * Loads the bundled Coolify OpenAPI spec and exposes small lookup helpers so the
 * LLM can read the API documentation before issuing free-form coolify_get /
 * coolify_mutate calls. The spec file sits at the package root and is therefore
 * one level up from the compiled file (dist/openapi.js) and from src/openapi.ts.
 */
const SPEC_URL = new URL("../openapi.json", import.meta.url);

interface OpenApiSpec {
  info?: { title?: string; version?: string; description?: string };
  servers?: { url?: string; description?: string }[];
  paths: Record<string, Record<string, any>>;
  components?: { schemas?: Record<string, any>; responses?: Record<string, any> };
}

let cached: OpenApiSpec | null = null;

function spec(): OpenApiSpec {
  if (!cached) {
    cached = JSON.parse(readFileSync(SPEC_URL, "utf8")) as OpenApiSpec;
  }
  return cached;
}

const HTTP_METHODS = ["get", "post", "patch", "put", "delete"] as const;

export interface EndpointSummary {
  method: string;
  path: string;
  tag: string;
  summary: string;
}

/** Compact list of every endpoint, optionally filtered by a case-insensitive substring. */
export function listEndpoints(filter?: string): EndpointSummary[] {
  const needle = filter?.trim().toLowerCase();
  const out: EndpointSummary[] = [];
  const s = spec();
  for (const [path, methods] of Object.entries(s.paths)) {
    for (const method of HTTP_METHODS) {
      const op = methods[method];
      if (!op) continue;
      const entry: EndpointSummary = {
        method: method.toUpperCase(),
        path,
        tag: (op.tags && op.tags[0]) || "",
        summary: op.summary || op.description || "",
      };
      if (
        !needle ||
        path.toLowerCase().includes(needle) ||
        entry.summary.toLowerCase().includes(needle) ||
        entry.tag.toLowerCase().includes(needle) ||
        (op.operationId || "").toLowerCase().includes(needle)
      ) {
        out.push(entry);
      }
    }
  }
  out.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
  return out;
}

/** Resolve a JSON pointer like "#/components/responses/400" against the spec. */
function resolvePointer(ref: string, s: OpenApiSpec): unknown {
  const parts = ref.replace(/^#\//, "").split("/");
  let node: any = s;
  for (const part of parts) {
    node = node?.[decodeURIComponent(part.replace(/~1/g, "/").replace(/~0/g, "~"))];
    if (node === undefined) return { $ref: ref };
  }
  return node;
}

/** Recursively inline $ref nodes, bounded by depth and a cycle guard. */
function deref(node: any, s: OpenApiSpec, depth = 0, seen: Set<string> = new Set()): any {
  if (depth > 8 || node === null || typeof node !== "object") return node;
  if (Array.isArray(node)) return node.map((n) => deref(n, s, depth + 1, seen));
  if (typeof node.$ref === "string") {
    if (seen.has(node.$ref)) return { $ref: node.$ref };
    const next = new Set(seen).add(node.$ref);
    return deref(resolvePointer(node.$ref, s), s, depth + 1, next);
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) out[k] = deref(v, s, depth + 1, seen);
  return out;
}

export interface EndpointDetail {
  method: string;
  path: string;
  summary?: string;
  description?: string;
  parameters?: { name: string; in: string; required: boolean; type?: string; description?: string }[];
  requestBody?: { required?: boolean; schema: unknown };
  responses?: Record<string, string>;
  notFound?: string;
}

/**
 * Full detail for one endpoint: parameters and the request-body schema are fully
 * resolved (so the LLM sees concrete field names); responses are listed compactly.
 */
export function getEndpoint(path: string, method?: string): EndpointDetail | { error: string } {
  const s = spec();
  const pathItem = s.paths[path];
  if (!pathItem) {
    return {
      error: `Unknown path '${path}'. Use coolify_api_overview (optionally with a filter) to list valid paths.`,
    };
  }
  const candidates = method
    ? [method.toLowerCase()].filter((m) => pathItem[m])
    : HTTP_METHODS.filter((m) => pathItem[m]);
  if (candidates.length === 0) {
    return { error: `Method '${method}' not defined for '${path}'.` };
  }
  // Default to the first matching method; callers can pass `method` to disambiguate.
  const m = candidates[0];
  const op = pathItem[m];

  const parameters = Array.isArray(op.parameters)
    ? op.parameters.map((p: any) => {
        const resolved = deref(p, s);
        return {
          name: resolved.name,
          in: resolved.in,
          required: !!resolved.required,
          type: resolved.schema?.type,
          description: resolved.description,
        };
      })
    : undefined;

  let requestBody: EndpointDetail["requestBody"];
  const rbSchema = op.requestBody?.content?.["application/json"]?.schema;
  if (rbSchema) {
    requestBody = { required: !!op.requestBody.required, schema: deref(rbSchema, s) };
  }

  const responses: Record<string, string> = {};
  for (const [code, resp] of Object.entries<any>(op.responses ?? {})) {
    const r = typeof resp?.$ref === "string" ? resolvePointer(resp.$ref, s) : resp;
    responses[code] = (r as any)?.description || "";
  }

  return {
    method: m.toUpperCase(),
    path,
    summary: op.summary,
    description: op.description,
    parameters,
    requestBody,
    responses,
  };
}

/** Title/version/base info for the bundled spec. */
export function specInfo() {
  const s = spec();
  return {
    title: s.info?.title,
    version: s.info?.version,
    server: s.servers?.[0]?.url,
    endpointCount: listEndpoints().length,
  };
}
