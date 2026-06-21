#!/usr/bin/env node
// Refreshes the bundled openapi.json from the official Coolify source.
// Usage: npm run update:api   (override source with COOLIFY_OPENAPI_URL=...)
import { writeFile } from "node:fs/promises";

const SOURCE =
  process.env.COOLIFY_OPENAPI_URL ||
  "https://raw.githubusercontent.com/coollabsio/coolify/main/openapi.json";

const dest = new URL("../openapi.json", import.meta.url);

const res = await fetch(SOURCE);
if (!res.ok) {
  console.error(`Download failed: HTTP ${res.status} from ${SOURCE}`);
  process.exit(1);
}

const text = await res.text();

// Validate it parses and looks like an OpenAPI document before overwriting.
let parsed;
try {
  parsed = JSON.parse(text);
} catch (err) {
  console.error("Downloaded file is not valid JSON:", err instanceof Error ? err.message : err);
  process.exit(1);
}
if (!parsed.openapi || !parsed.paths) {
  console.error("Downloaded JSON does not look like an OpenAPI spec (missing 'openapi'/'paths').");
  process.exit(1);
}

await writeFile(dest, text);
const pathCount = Object.keys(parsed.paths).length;
console.log(
  `Updated openapi.json from ${SOURCE}\n` +
    `  openapi ${parsed.openapi}, version ${parsed.info?.version ?? "?"}, ${pathCount} paths, ${text.length} bytes`,
);
