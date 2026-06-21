import { test } from "node:test";
import assert from "node:assert/strict";
import { listEndpoints, getEndpoint, specInfo } from "../src/openapi.js";

test("specInfo reports a populated, bundled spec", () => {
  const info = specInfo();
  assert.equal(info.server, "https://app.coolify.io/api/v1");
  assert.ok(info.endpointCount > 50, "expected a substantial endpoint count");
});

test("listEndpoints returns all endpoints and filters by substring", () => {
  const all = listEndpoints();
  assert.ok(all.length > 50);
  // Sorted by path.
  assert.ok(all.some((e) => e.path === "/projects" && e.method === "POST"));

  const dbs = listEndpoints("database");
  assert.ok(dbs.length > 0 && dbs.length < all.length);
  assert.ok(dbs.every((e) => `${e.path} ${e.summary} ${e.tag}`.toLowerCase().includes("database")));
});

test("getEndpoint resolves required request-body fields", () => {
  const detail = getEndpoint("/databases/postgresql", "POST");
  assert.ok(!("error" in detail));
  const d = detail as Extract<typeof detail, { method: string }>;
  assert.equal(d.method, "POST");
  const schema = d.requestBody?.schema as any;
  assert.ok(Array.isArray(schema.required));
  for (const f of ["server_uuid", "project_uuid", "environment_name"]) {
    assert.ok(schema.required.includes(f), `expected required field ${f}`);
  }
});

test("getEndpoint dereferences shared $ref responses", () => {
  const d = getEndpoint("/projects", "POST") as any;
  // 401 is a shared component response ($ref) — must be inlined to a description string.
  assert.equal(typeof d.responses["401"], "string");
  assert.ok(d.responses["401"].length > 0);
});

test("getEndpoint returns a helpful error for unknown paths", () => {
  const res = getEndpoint("/does-not-exist") as any;
  assert.ok(res.error);
  assert.match(res.error, /coolify_api_overview/);
});
