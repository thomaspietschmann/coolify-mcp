import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";

const KEYS = [
  "COOLIFY_BASE_URL",
  "COOLIFY_API_TOKEN",
  "COOLIFY_ALLOW_MUTATIONS",
  "COOLIFY_TIMEOUT_MS",
];
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

test("throws when required variables are missing", () => {
  assert.throws(() => loadConfig(), /COOLIFY_BASE_URL/);
  process.env.COOLIFY_BASE_URL = "https://x.test";
  assert.throws(() => loadConfig(), /COOLIFY_API_TOKEN/);
});

test("strips trailing slashes from the base URL", () => {
  process.env.COOLIFY_BASE_URL = "https://coolify.test///";
  process.env.COOLIFY_API_TOKEN = "tok";
  assert.equal(loadConfig().baseUrl, "https://coolify.test");
});

test("allowMutations defaults to true and can be disabled", () => {
  process.env.COOLIFY_BASE_URL = "https://coolify.test";
  process.env.COOLIFY_API_TOKEN = "tok";
  assert.equal(loadConfig().allowMutations, true);

  process.env.COOLIFY_ALLOW_MUTATIONS = "false";
  assert.equal(loadConfig().allowMutations, false);

  process.env.COOLIFY_ALLOW_MUTATIONS = "FALSE";
  assert.equal(loadConfig().allowMutations, false);

  process.env.COOLIFY_ALLOW_MUTATIONS = "true";
  assert.equal(loadConfig().allowMutations, true);
});

test("timeout falls back to 30000 on missing/invalid values", () => {
  process.env.COOLIFY_BASE_URL = "https://coolify.test";
  process.env.COOLIFY_API_TOKEN = "tok";
  assert.equal(loadConfig().timeoutMs, 30000);

  process.env.COOLIFY_TIMEOUT_MS = "5000";
  assert.equal(loadConfig().timeoutMs, 5000);

  process.env.COOLIFY_TIMEOUT_MS = "not-a-number";
  assert.equal(loadConfig().timeoutMs, 30000);

  process.env.COOLIFY_TIMEOUT_MS = "-1";
  assert.equal(loadConfig().timeoutMs, 30000);
});
