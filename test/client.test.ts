import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { CoolifyClient, CoolifyError } from "../src/client.js";

const cfg = {
  baseUrl: "https://coolify.test",
  token: "test-token",
  allowMutations: true,
  timeoutMs: 30000,
};

let realFetch: typeof globalThis.fetch;
beforeEach(() => {
  realFetch = globalThis.fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

test("builds /api/v1 URL, sets auth header and serializes query + body", async () => {
  let captured: { url: string; init: RequestInit } | null = null;
  globalThis.fetch = (async (url: any, init: any) => {
    captured = { url: String(url), init };
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as any;

  const client = new CoolifyClient(cfg);
  const result = await client.request("POST", "/applications", {
    query: { force: true, skip: undefined },
    body: { name: "demo" },
  });

  assert.deepEqual(result, { ok: true });
  assert.ok(captured, "fetch was called");
  assert.equal(captured!.url, "https://coolify.test/api/v1/applications?force=true");
  assert.equal((captured!.init.headers as any).Authorization, "Bearer test-token");
  assert.equal(captured!.init.method, "POST");
  assert.equal(captured!.init.body, JSON.stringify({ name: "demo" }));
});

test("non-2xx responses throw CoolifyError with status and parsed body", async () => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ message: "nope" }), {
      status: 422,
      headers: { "content-type": "application/json" },
    })) as any;

  const client = new CoolifyClient(cfg);
  await assert.rejects(
    () => client.get("/applications"),
    (err: unknown) => {
      assert.ok(err instanceof CoolifyError);
      assert.equal(err.status, 422);
      assert.deepEqual(err.body, { message: "nope" });
      return true;
    },
  );
});

test("a timeout aborts and surfaces as CoolifyError", async () => {
  // fetch never resolves on its own; it rejects when the abort signal fires.
  globalThis.fetch = ((_url: any, init: any) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => {
        const e = new Error("aborted");
        e.name = "AbortError";
        reject(e);
      });
    })) as any;

  const client = new CoolifyClient({ ...cfg, timeoutMs: 10 });
  await assert.rejects(
    () => client.get("/applications"),
    (err: unknown) => {
      assert.ok(err instanceof CoolifyError);
      assert.match(String(err.body), /timed out/i);
      return true;
    },
  );
});
