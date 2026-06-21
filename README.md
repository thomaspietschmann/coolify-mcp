# coolify-mcp

> ℹ️ This project was created with the help of AI.

An [MCP](https://modelcontextprotocol.io) server for [Coolify](https://coolify.io).

The server keeps your Coolify API token in **its own process environment** and exposes
only abstract tools to the LLM agent (`list_applications`, `deploy_application`, …).
**The token therefore never ends up in the model context or in tool arguments.**

- **Read** any time: projects, servers, applications, databases, services, deployments, resources.
- **Write & deploy** double-gated: a global switch (`COOLIFY_ALLOW_MUTATIONS`) **and** a
  per-call `confirm: true`. Without `confirm`, you only get a preview.

> **Disclaimer:** This MCP server executes real actions against your Coolify instance.
> Use it at your own risk; the author assumes no liability for unintended deployments,
> data loss, or outages caused by LLM-driven tool calls.

---

## Contents

1. [Requirements](#requirements)
2. [Installation](#installation)
3. [Create a Coolify API token](#create-a-coolify-api-token)
4. [Configuration & example config](#configuration--example-config)
5. [Usage](#usage)
6. [Tool overview](#tool-overview)
7. [Security model](#security-model)
8. [Troubleshooting](#troubleshooting)

---

## Requirements

- **Node.js ≥ 20** (`node --version`)
- A reachable **Coolify instance** (self-hosted or `https://app.coolify.io`)
- A **Coolify API token**

## Installation

```bash
git clone git@github.com:thomaspietschmann/coolify-mcp.git
cd coolify-mcp
npm install
npm run build
```

This produces `dist/index.js` — the file the MCP client starts.

> After code changes, run `npm run build` again (or `npm run dev` for watch mode).

## Create a Coolify API token

1. Log in to Coolify → top right on your profile → **Keys & Tokens**.
2. Tab **API Tokens** → **Create New Token**.
3. Choose a scope:
   - **`read-only`** → read access only (pairs with `COOLIFY_ALLOW_MUTATIONS=false`).
   - **`read:write`** (i.e. without the "read-only" checkbox) → required for deploy/write.
4. Copy the token — it is shown **only once**.

## Configuration & example config

Settings are provided via the **`env` block of the MCP config** — **no `.env` required**.
This keeps the token in the client config so it never reaches the model.

| Variable | Required | Default | Description |
|---|---|---|---|
| `COOLIFY_BASE_URL` | ✅ | – | Base URL of the instance, **without** trailing slash, e.g. `https://coolify.example.com` |
| `COOLIFY_API_TOKEN` | ✅ | – | Your API token |
| `COOLIFY_ALLOW_MUTATIONS` | – | `true` | `false` ⇒ full read-only mode (all write/deploy tools off) |
| `COOLIFY_TIMEOUT_MS` | – | `30000` | Request timeout in milliseconds |

> Always give the path in `args` as an **absolute** path and adapt it to your clone.

### Example — Claude Code (CLI)

Option A: create a `.mcp.json` file in your project directory:

```json
{
  "mcpServers": {
    "coolify": {
      "command": "node",
      "args": ["/path/to/coolify-mcp/dist/index.js"],
      "env": {
        "COOLIFY_BASE_URL": "https://coolify.example.com",
        "COOLIFY_API_TOKEN": "1|xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        "COOLIFY_ALLOW_MUTATIONS": "true",
        "COOLIFY_TIMEOUT_MS": "30000"
      }
    }
  }
}
```

Option B: add it via command:

```bash
claude mcp add coolify \
  -e COOLIFY_BASE_URL=https://coolify.example.com \
  -e COOLIFY_API_TOKEN=1|xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx \
  -e COOLIFY_ALLOW_MUTATIONS=true \
  -- node /path/to/coolify-mcp/dist/index.js
```

Verify, then use the tools:

```bash
claude mcp list          # shows "coolify"
# inside a session:
/mcp                     # lists connected servers & tools
```

### Example — Claude Desktop

Open the config file:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "coolify": {
      "command": "node",
      "args": ["/path/to/coolify-mcp/dist/index.js"],
      "env": {
        "COOLIFY_BASE_URL": "https://coolify.example.com",
        "COOLIFY_API_TOKEN": "1|xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        "COOLIFY_ALLOW_MUTATIONS": "true"
      }
    }
  }
}
```

Then **fully restart** Claude Desktop. The server appears under the 🔌 / tools menu.

### Read-only operation

For a configuration that can guaranteed make no changes, simply set:

```json
"COOLIFY_ALLOW_MUTATIONS": "false"
```

All write/deploy tools then return only a notice instead of performing an action.

### Local testing without an MCP client (optional)

There is a `.env.example`. For development only:

```bash
cp .env.example .env      # fill in values
node dist/index.js        # automatically reads .env if present
```

Values from the MCP `env` block take precedence over `.env`. The `.env` file is in `.gitignore`.

## Usage

Once the server is connected, just talk to the agent — it picks the tools itself.
Examples:

| You say … | The agent calls … |
|---|---|
| "Which apps are running in Coolify?" | `list_applications` |
| "Show me details for app `abc-123`." | `get_application { uuid: "abc-123" }` |
| "Redeploy app `abc-123`." | `deploy_application { uuid: "abc-123", confirm: true }` |
| "Set env `LOG_LEVEL=debug` for `abc-123`." | `create_application_env { uuid, key, value, confirm: true }` |
| "Stop database `db-9`." | `stop_database { uuid: "db-9", confirm: true }` |

**Preview before execution:** if the agent calls a write tool **without** `confirm: true`,
it only gets a preview back, e.g.:

```
PREVIEW (not executed) — Start deployment for 'abc-123'.
To execute, repeat the same call with confirm:true.
```

Only when repeated with `confirm: true` is the Coolify API actually called
(and Claude additionally shows its own permission prompt for destructive tools).

### Full API coverage via free-form calls

Two generic tools reach **every** Coolify API endpoint — the credentials are injected by
the server, the LLM only supplies method, path and body:

- `coolify_get { path, query? }` — arbitrary **GET** against `/api/v1` (read-only).
- `coolify_mutate { method, path, body?, confirm: true }` — arbitrary POST/PATCH/PUT/DELETE.

So creating projects, adding databases, editing service/database env vars, configuring
storage, backups, scheduled tasks, etc. all work today, even where there is no dedicated tool.

### Built-in API documentation

The official Coolify OpenAPI spec is bundled with the server, so the LLM can look up the
right path and fields **before** a free-form call (no internet needed):

- `coolify_api_overview { filter? }` — compact list of all endpoints (method, path, summary);
  filter by substring like `"database"` or `"project"`.
- `coolify_api_endpoint { path, method? }` — full detail for one endpoint: parameters and the
  request-body schema (field names, types, which are required) plus response codes.

Typical flow: `coolify_api_overview` → `coolify_api_endpoint` → `coolify_mutate`.

> Note: the API is slightly narrower than the web UI. For example, creating a Docker-Compose
> app is not exposed by the API (only Dockerfile, Docker image, public/private Git repos).

## Tool overview

**Read (any time):**
`coolify_version`, `coolify_health`, `list_teams`, `get_current_team`, `list_private_keys`,
`list_projects`, `get_project`, `list_servers`, `get_server`, `get_server_resources`,
`list_resources`, `list_applications`, `get_application`, `list_application_envs`,
`list_databases`, `get_database`, `list_services`, `get_service`, `list_deployments`,
`get_deployment`, `coolify_api_overview`, `coolify_api_endpoint`, `coolify_get`.

**Write / deploy (requires `confirm: true`):**
`deploy_application`, `start_application`, `stop_application`, `restart_application`,
`update_application`, `delete_application`, `create_application_env`, `update_application_env`,
`delete_application_env`, `create_application_public`, `create_application_dockerimage`,
`start_service`, `stop_service`, `restart_service`,
`start_database`, `stop_database`, `restart_database`,
`coolify_mutate`.

## Security model

1. **Token isolation:** the API token lives only in the server process (from the MCP `env`
   block). It never appears in the LLM context, in prompts, or in tool arguments.
2. **Global switch:** `COOLIFY_ALLOW_MUTATIONS=false` disables *all* write tools.
3. **Confirm gate:** every write action requires `confirm: true`; otherwise just a preview.
4. **Client prompt:** destructive tools are marked via the MCP `destructiveHint`, so the
   client additionally shows its own confirmation dialog.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Server won't start, "Missing required environment variable(s)" | `COOLIFY_BASE_URL` and/or `COOLIFY_API_TOKEN` missing from the `env` block. |
| `Coolify error (HTTP 401)` | Token invalid/expired → create a new token. |
| `Coolify error (HTTP 403)` | Token has no write scope but a write tool was used. |
| `Coolify error (HTTP 404)` | Wrong UUID or the endpoint path differs → probe with `coolify_get`/`coolify_mutate`. |
| `Request timed out` | Instance slow/unreachable → increase `COOLIFY_TIMEOUT_MS`, check the URL. |
| Tools don't appear in the client | Is the `args` path absolute? Did `npm run build` run? Did you restart the client? |

## Development

### Tests

```bash
npm test
```

Uses the built-in Node test runner (`node:test`) with `fetch` mocked — no network, no live
Coolify needed. Covered:

- **Confirm/read-only gating** (`test/server.test.ts`): write tools return a preview without
  `confirm`, perform the call with `confirm:true`, and are refused when
  `COOLIFY_ALLOW_MUTATIONS=false` — driven through a real MCP client over an in-memory transport.
- **HTTP client** (`test/client.test.ts`): URL/`/api/v1` building, query/body serialization,
  auth header, `CoolifyError` on non-2xx, timeout handling.
- **Config parsing** (`test/config.test.ts`): required vars, slash stripping, flag/timeout defaults.
- **OpenAPI lookup** (`test/openapi.test.ts`): endpoint listing/filtering and `$ref` resolution.

### Keeping the bundled API spec up to date

The `openapi.json` spec is only a **lookup aid** for the LLM — real calls always go to your live
instance, so a stale spec never breaks functionality, it only affects discovery hints.

Refresh it on demand:

```bash
npm run update:api        # downloads the latest spec, validates it, overwrites openapi.json
# override the source if needed:
COOLIFY_OPENAPI_URL=https://your-instance/openapi.json npm run update:api
```

Then commit the changed `openapi.json`. A weekly GitHub Action
(`.github/workflows/update-openapi.yml`) also runs this and opens a PR when the spec changed.

## Created with AI

This project — code and documentation — was created with the help of AI.

## License

MIT
