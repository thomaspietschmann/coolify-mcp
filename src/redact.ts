/**
 * Central secret redaction for Coolify API responses.
 *
 * The whole point of this server is that secrets never reach the LLM context.
 * The Coolify API, however, embeds secret material in many responses that the
 * caller did not explicitly ask for: SSH private keys (also base64-encoded
 * inside deployment log strings), database passwords, webhook secrets, the
 * server sentinel token, log-drain API keys, etc.
 *
 * `redactSecrets` walks any parsed JSON value and neutralizes those secrets:
 *  1. By field name — keys on the denylist get their value replaced with the
 *     marker, regardless of nesting depth.
 *  2. By content — every string is scrubbed for embedded PEM private keys and
 *     their base64 encoding (as seen in deployment logs).
 *
 * Deliberately NOT redacted, so the server stays useful:
 *  - `value` / `real_value` — application/service environment variables. Reading
 *    and managing env vars is an explicit purpose of this server, so their
 *    values (which may themselves be connection strings or secrets) stay visible.
 *  - `public_key`, `fingerprint` — not secret.
 *  - any key ending in `_id` — an identifier referencing a secret is not itself
 *    secret (e.g. `private_key_id`, `cloud_provider_token_id`).
 */

export const REDACTED = "[redacted]";

/**
 * True if a JSON object key denotes a secret value that should be redacted.
 * Matching is case-insensitive on the key name only.
 */
export function isSecretKey(key: string): boolean {
  const k = key.toLowerCase();

  // An identifier that references a secret is not itself a secret.
  if (k.endsWith("_id")) return false;

  // Environment-variable values are intentionally readable (env management).
  if (k === "value" || k === "real_value") return false;

  return (
    k === "private_key" ||
    k.includes("password") ||
    k.includes("secret") ||
    k.includes("token") ||
    k.includes("api_key") ||
    k.includes("license_key") ||
    k === "internal_db_url" ||
    k === "external_db_url" ||
    k.endsWith("_db_url")
  );
}

// Raw PEM private key block, e.g. "-----BEGIN OPENSSH PRIVATE KEY----- ... -----END ... -----".
const PEM_PRIVATE_KEY =
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g;

// Base64 of a PEM private key. The encoding of "-----BEGIN " ... "PRIVATE KEY"
// always begins with "LS0tLS1CRUdJTi". Coolify embeds these inside deployment
// log strings (echo '<base64>' | base64 -d > id_rsa...).
const BASE64_PRIVATE_KEY = /LS0tLS1CRUdJTi[A-Za-z0-9+/=]{20,}/g;

/** Scrub secret material embedded inside a free-form string (e.g. log output). */
function scrubString(value: string): string {
  return value
    .replace(PEM_PRIVATE_KEY, `${REDACTED} private key`)
    .replace(BASE64_PRIVATE_KEY, `${REDACTED} base64 private key`);
}

/**
 * Recursively redact secrets in a parsed JSON value. Returns a new value;
 * the input is not mutated. Null/undefined secret values are left as-is so the
 * caller can still tell that nothing was set (vs. a hidden value).
 */
export function redactSecrets<T>(value: T): T {
  if (typeof value === "string") return scrubString(value) as unknown as T;
  if (value === null || typeof value !== "object") return value;

  if (Array.isArray(value)) {
    return value.map((v) => redactSecrets(v)) as unknown as T;
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (isSecretKey(k) && v !== null && v !== undefined && v !== "") {
      out[k] = REDACTED;
    } else {
      out[k] = redactSecrets(v);
    }
  }
  return out as unknown as T;
}
