import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "../src/server.js";

const baseCfg = {
  baseUrl: "https://coolify.test",
  token: "test-token",
  allowMutations: true,
  timeoutMs: 30000,
};

let realFetch: typeof globalThis.fetch;
let fetchCalls: { url: string; method: string }[];

beforeEach(() => {
  realFetch = globalThis.fetch;
  fetchCalls = [];
  globalThis.fetch = (async (url: any, init: any) => {
    fetchCalls.push({ url: String(url), method: init?.method ?? "GET" });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as any;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

async function connect(cfg = baseCfg) {
  const server = buildServer(cfg);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientT);
  return client;
}

function textOf(res: any): string {
  return res.content.map((c: any) => c.text).join("\n");
}

test("write tool without confirm returns a preview and does NOT call the API", async () => {
  const client = await connect();
  const res = await client.callTool({
    name: "deploy_application",
    arguments: { uuid: "app-1" },
  });
  assert.match(textOf(res), /PREVIEW \(not executed\)/);
  assert.equal(fetchCalls.length, 0, "no API call should happen without confirm");
});

test("write tool with confirm:true performs the API call", async () => {
  const client = await connect();
  const res = await client.callTool({
    name: "deploy_application",
    arguments: { uuid: "app-1", confirm: true },
  });
  assert.equal(fetchCalls.length, 1);
  assert.match(fetchCalls[0].url, /\/api\/v1\/deploy\?uuid=app-1/);
  assert.ok(!res.isError);
});

test("write tools are refused entirely when mutations are disabled", async () => {
  const client = await connect({ ...baseCfg, allowMutations: false });
  const res = await client.callTool({
    name: "deploy_application",
    arguments: { uuid: "app-1", confirm: true },
  });
  assert.equal(res.isError, true);
  assert.match(textOf(res), /read-only mode/);
  assert.equal(fetchCalls.length, 0);
});

test("read tools always call the API", async () => {
  const client = await connect();
  const res = await client.callTool({
    name: "list_applications",
    arguments: {},
  });
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].method, "GET");
  assert.match(fetchCalls[0].url, /\/api\/v1\/applications$/);
  assert.ok(!res.isError);
});

test("the documentation tools are available and read-only (no API call)", async () => {
  const client = await connect();
  const list = await client.listTools();
  const names = list.tools.map((t) => t.name);
  assert.ok(names.includes("coolify_api_overview"));
  assert.ok(names.includes("coolify_api_endpoint"));

  const res = await client.callTool({
    name: "coolify_api_endpoint",
    arguments: { path: "/projects", method: "POST" },
  });
  assert.equal(fetchCalls.length, 0, "doc lookups must not hit the API");
  assert.match(textOf(res), /requestBody|name/);
});
