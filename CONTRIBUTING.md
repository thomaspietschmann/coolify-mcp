# Contributing

Contributions are welcome.

## Setup

```bash
git clone git@github.com:thomaspietschmann/coolify-mcp.git
cd coolify-mcp
npm install
npm run build
```

## Tests

```bash
npm test           # run all tests (node:test, no network required)
npm run typecheck  # TypeScript type-check without emitting
```

All tests run via the built-in Node test runner (`node:test`) with `fetch` mocked — no live
Coolify instance is needed. Please keep coverage for any changed logic.

## Keeping the OpenAPI spec current

The bundled `openapi.json` is a lookup aid for the LLM. Refresh it before opening a PR
that adds or changes tool paths:

```bash
npm run update:api
git add openapi.json
```

A weekly GitHub Action also does this automatically and opens a PR when the spec changes.

## Pull requests

- Keep commits focused; one logical change per commit.
- Commit messages in English.
- The README is the single source of user documentation — update it if behaviour changes.
- No `Co-Authored-By` or "generated with" lines in commit messages.