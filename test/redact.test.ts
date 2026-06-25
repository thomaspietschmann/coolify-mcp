import { test } from "node:test";
import assert from "node:assert/strict";
import { redactSecrets, isSecretKey, REDACTED } from "../src/redact.js";

test("redacts dedicated secret fields by name", () => {
  const input = {
    uuid: "abc",
    name: "db",
    postgres_password: "supersecret",
    manual_webhook_secret_github: "ghtoken",
    sentinel_token: "sentinel",
    logdrain_axiom_api_key: "axiomkey",
    internal_db_url: "postgres://postgres:pw@host:5432/db",
    http_basic_auth_password: "euchalle",
  };
  const out = redactSecrets(input) as any;
  assert.equal(out.uuid, "abc");
  assert.equal(out.name, "db");
  assert.equal(out.postgres_password, REDACTED);
  assert.equal(out.manual_webhook_secret_github, REDACTED);
  assert.equal(out.sentinel_token, REDACTED);
  assert.equal(out.logdrain_axiom_api_key, REDACTED);
  assert.equal(out.internal_db_url, REDACTED);
  assert.equal(out.http_basic_auth_password, REDACTED);
});

test("does NOT redact env variable values or identifiers", () => {
  const env = {
    key: "DATABASE_URL",
    value: "postgres://postgres:pw@host:5432/db",
    real_value: "postgres://postgres:pw@host:5432/db",
    private_key_id: 8,
    cloud_provider_token_id: 3,
  };
  const out = redactSecrets(env) as any;
  // Env values stay visible — managing env vars is an explicit purpose.
  assert.equal(out.value, "postgres://postgres:pw@host:5432/db");
  assert.equal(out.real_value, "postgres://postgres:pw@host:5432/db");
  // *_id fields reference secrets but are not secret themselves.
  assert.equal(out.private_key_id, 8);
  assert.equal(out.cloud_provider_token_id, 3);
});

test("keeps public_key and fingerprint, redacts private_key", () => {
  const key = {
    name: "deploy-key",
    fingerprint: "SHA256:abc",
    public_key: "ssh-ed25519 AAAA...",
    private_key: "-----BEGIN OPENSSH PRIVATE KEY-----\nXXXX\n-----END OPENSSH PRIVATE KEY-----",
  };
  const out = redactSecrets(key) as any;
  assert.equal(out.fingerprint, "SHA256:abc");
  assert.equal(out.public_key, "ssh-ed25519 AAAA...");
  assert.equal(out.private_key, REDACTED);
});

test("scrubs raw PEM private keys embedded in strings", () => {
  const s =
    "prefix -----BEGIN OPENSSH PRIVATE KEY-----\nLINE1\nLINE2\n-----END OPENSSH PRIVATE KEY----- suffix";
  const out = redactSecrets(s) as string;
  assert.ok(!out.includes("BEGIN OPENSSH"), "raw PEM must be scrubbed");
  assert.ok(out.includes("prefix") && out.includes("suffix"), "surrounding text kept");
  assert.match(out, /\[redacted\] private key/);
});

test("scrubs base64-encoded private keys inside log strings", () => {
  // base64 of "-----BEGIN OPENSSH PRIVATE KEY-----\n..." starts with LS0tLS1CRUdJTi
  const log =
    "docker exec ... echo 'LS0tLS1CRUdJTiBPUEVOU1NIIFBSSVZBVEUgS0VZLS0tLS0KYjNCbGJuTnphQzFyWlhrdGRqRUFBQUFBQkc1dmJtVQ==' | base64 -d > id_rsa";
  const out = redactSecrets(log) as string;
  assert.ok(!out.includes("LS0tLS1CRUdJTi"), "base64 key must be scrubbed");
  assert.match(out, /\[redacted\] base64 private key/);
});

test("recurses through nested objects and arrays", () => {
  const input = {
    servers: [
      { name: "s1", settings: { sentinel_token: "tok", is_usable: true } },
    ],
  };
  const out = redactSecrets(input) as any;
  assert.equal(out.servers[0].settings.sentinel_token, REDACTED);
  assert.equal(out.servers[0].settings.is_usable, true);
});

test("leaves null/empty secret fields untouched (distinguish unset)", () => {
  const input = { logdrain_axiom_api_key: null, postgres_password: "" };
  const out = redactSecrets(input) as any;
  assert.equal(out.logdrain_axiom_api_key, null);
  assert.equal(out.postgres_password, "");
});

test("isSecretKey classification", () => {
  assert.equal(isSecretKey("private_key"), true);
  assert.equal(isSecretKey("postgres_password"), true);
  assert.equal(isSecretKey("manual_webhook_secret_gitea"), true);
  assert.equal(isSecretKey("sentinel_token"), true);
  assert.equal(isSecretKey("value"), false);
  assert.equal(isSecretKey("real_value"), false);
  assert.equal(isSecretKey("private_key_id"), false);
  assert.equal(isSecretKey("public_key"), false);
  assert.equal(isSecretKey("fingerprint"), false);
});
