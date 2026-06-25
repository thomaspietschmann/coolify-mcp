# Changelog

All notable changes to this project are documented here.

## [0.2.0] - 2026-06-25

### Security
- **Central secret redaction for every API response.** Coolify embeds secrets in many
  responses the caller never asked for. A new `redactSecrets` filter (`src/redact.ts`),
  applied in the HTTP client, now neutralizes them before they can reach the LLM:
  - Redacts secret-bearing fields by name: `private_key`, `*_password`, `*_secret*`,
    `*_token` (e.g. `sentinel_token`, `manual_webhook_secret_*`), log-drain API keys, and
    `internal_db_url`/`external_db_url`.
  - Scrubs SSH private keys embedded in deployment logs — both raw PEM blocks and their
    base64 encoding (`get_deployment` previously leaked the full deploy key this way).
  - Leaves non-secret data intact, and deliberately keeps **environment-variable values
    readable** (`value` / `real_value`) and `*_id` identifiers, so the server stays useful.
- This supersedes the 0.1.x ad-hoc `list_private_keys` redaction with a single, tested
  chokepoint that also covers `get_database`, `get_application`, `get_deployment`,
  `list_servers`/`get_server`, and the generic `coolify_get` / `coolify_mutate` escape hatches.

### Changed
- Dependencies updated to current majors: `zod` 4, TypeScript 6, `@types/node` 26, and the
  MCP SDK floor raised to `^1.29`. Migrated `z.record(...)` calls to the zod-4 two-argument
  form and replaced the removed `z.objectOutputType` helper.
- `coolify_get` query parameters now accept `string | number | boolean` (was string-only).
- Timeout/network failures now render as "Coolify request failed: …" instead of
  the misleading "Coolify error (HTTP 0)".

### Added
- `.github/workflows/ci.yml` — runs typecheck, tests and build on every push and PR.
- Test suites for the redaction filter (`test/redact.test.ts`) and the secret-leak paths.

## [0.1.0]

- Initial release: read/write/deploy MCP server for Coolify with token isolation,
  double-gated mutations (`COOLIFY_ALLOW_MUTATIONS` + per-call `confirm`), bundled OpenAPI
  lookup tools, and generic `coolify_get` / `coolify_mutate` escape hatches.
