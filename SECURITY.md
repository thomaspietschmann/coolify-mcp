# Security

## Token handling

The Coolify API token never enters the LLM context. It is supplied via the **`env` block** of the
MCP client configuration (`.mcp.json`, `claude_desktop_config.json`, or `claude mcp add -e …`).
The server reads it from `process.env` at startup, stores it in its in-process `Config`, and
attaches it as an `Authorization: Bearer` header on every outbound HTTP request to Coolify.
It is never placed in tool schemas, tool arguments, previews, or responses.

## Mutation gating

All write and deploy operations are protected by two independent gates:

1. **Global switch** — `COOLIFY_ALLOW_MUTATIONS=false` disables every write tool entirely.
   Calling one returns a notice, not an action.
2. **Per-call confirm** — each write tool requires `confirm: true` in the tool arguments.
   Without it, the tool returns a `PREVIEW (not executed)` string and makes no API call.

Destructive tools are also annotated with the MCP `destructiveHint`, so conforming clients
(e.g. Claude Code) add their own confirmation dialog.

## Disclaimer

This MCP server executes real actions against your Coolify instance. LLM-driven tool calls
can behave unexpectedly. Use it at your own risk; the author assumes no liability for
unintended deployments, data loss, or outages.

## Reporting vulnerabilities

Please open a [GitHub issue](https://github.com/thomaspietschmann/coolify-mcp/issues) with the
label `security`. For sensitive reports, contact the author directly via GitHub.