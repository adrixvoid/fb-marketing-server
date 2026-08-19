import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";

const token = "test-service-token-not-a-secret";
const time = new Date("2026-08-19T12:00:00.000Z");

test("routes an authenticated loopback request through OpenAPI validation", async (t) => {
  const app = await buildApp({ serviceToken: token, now: () => time });
  t.after(() => app.close());

  const response = await app.inject({
    method: "GET",
    url: "/health",
    headers: { authorization: `Bearer ${token}`, "x-request-id": "request-1234" },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["x-request-id"], "request-1234");
  assert.deepEqual(response.json(), { status: "ok", time: time.toISOString() });
});

test("rejects missing and invalid service bearers", async (t) => {
  const app = await buildApp({ serviceToken: token });
  t.after(() => app.close());

  for (const authorization of [undefined, "Bearer wrong-token"]) {
    const response = await app.inject({
      method: "GET",
      url: "/health",
      headers: authorization ? { authorization } : {},
    });
    assert.equal(response.statusCode, 401);
    assert.equal(response.headers["www-authenticate"], "Bearer");
    assert.equal(response.json().code, "unauthorized");
  }
});

test("rejects non-loopback callers before contract handlers", async (t) => {
  const app = await buildApp({ serviceToken: token });
  t.after(() => app.close());

  const response = await app.inject({
    method: "GET",
    url: "/health",
    headers: { authorization: `Bearer ${token}` },
    remoteAddress: "192.0.2.1",
  });

  assert.equal(response.statusCode, 403);
});

test("validates OpenAPI request inputs and generated responses", async (t) => {
  const app = await buildApp({ serviceToken: token });
  t.after(() => app.close());

  const response = await app.inject({
    method: "GET",
    url: "/health",
    headers: { authorization: `Bearer ${token}`, "x-request-id": "short" },
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.json().code, "validation_error");
  assert.match(String(response.headers["x-request-id"] ?? ""), /^[0-9a-f-]{36}$/);
});

test("keeps multipart stream validation outside normal OpenAPI body validation", async (t) => {
  const app = await buildApp({ serviceToken: token });
  t.after(() => app.close());

  const boundary = "test-boundary";
  const response = await app.inject({
    method: "POST",
    url: "/v1/media",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": `multipart/form-data; boundary=${boundary}`,
    },
    payload: `--${boundary}--\r\n`,
  });

  assert.equal(response.statusCode, 422);
  assert.equal(response.json().code, "media_invalid");
});

test("keeps model paths and URLs outside the disabled media boundary", async (t) => {
  const app = await buildApp({ serviceToken: token });
  t.after(() => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/v1/media",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    payload: { path: "/tmp/model-file.jpg", url: "https://example.invalid/file.jpg" },
  });

  assert.equal(response.statusCode, 422);
  assert.equal(response.json().code, "media_invalid");
  assert.equal(response.json().detail, "Multipart media handling is not enabled yet");
});

test("rejects an invalid documented problem response as a normalized 500", async (t) => {
  const app = await buildApp({
    serviceToken: token,
    handlers: {
      getHealth: () => ({
        statusCode: 401,
        mediaType: "application/problem+json",
        headers: { "x-request-id": "invalid-problem-1" },
        body: { status: 401, code: "unauthorized", extra: true },
      }),
    },
  });
  t.after(() => app.close());

  const response = await app.inject({
    method: "GET",
    url: "/health",
    headers: { authorization: `Bearer ${token}` },
  });

  assert.equal(response.statusCode, 500);
  assert.equal(response.headers["content-type"], "application/problem+json; charset=utf-8");
  assert.equal(response.json().code, "internal_error");
});

test("rejects an invalid success handler response as a normalized 500", async (t) => {
  const app = await buildApp({
    serviceToken: token,
    handlers: {
      getHealth: () => ({
        statusCode: 200,
        mediaType: "application/json",
        body: { status: "ok", time: time.toISOString(), extra: true },
      }),
    },
  });
  t.after(() => app.close());

  const response = await app.inject({
    method: "GET",
    url: "/health",
    headers: { authorization: `Bearer ${token}` },
  });

  assert.equal(response.statusCode, 500);
  assert.equal(response.json().code, "internal_error");
});

test("fails closed when the declared response status has no schema", async (t) => {
  const app = await buildApp({
    serviceToken: token,
    handlers: {
      getHealth: () => ({
        statusCode: 201,
        mediaType: "application/json",
        body: { status: "ok", time: time.toISOString() },
      }),
    },
  });
  t.after(() => app.close());

  const response = await app.inject({
    method: "GET",
    url: "/health",
    headers: { authorization: `Bearer ${token}` },
  });

  assert.equal(response.statusCode, 500);
  assert.equal(response.json().code, "internal_error");
});

test("validates the actual response media type and fails closed when its schema is absent", async (t) => {
  const app = await buildApp({
    serviceToken: token,
    handlers: {
      getHealth: () => ({
        statusCode: 200,
        mediaType: "application/json",
        headers: { "content-type": "application/problem+json" },
        body: { status: "ok", time: time.toISOString() },
      }),
    },
  });
  t.after(() => app.close());

  const response = await app.inject({
    method: "GET",
    url: "/health",
    headers: { authorization: `Bearer ${token}` },
  });

  assert.equal(response.statusCode, 500);
  assert.equal(response.json().code, "internal_error");
});

test("normalizes mixed-case Content-Type with charset before selecting the response schema", async (t) => {
  const app = await buildApp({
    serviceToken: token,
    handlers: {
      getHealth: () => ({
        statusCode: 200,
        mediaType: "application/json",
        headers: {
          "Content-Type": "application/problem+json; charset=utf-8",
          "x-request-id": "mixed-media-1",
        },
        body: { status: "ok", time: time.toISOString() },
      }),
    },
  });
  t.after(() => app.close());

  const response = await app.inject({
    method: "GET",
    url: "/health",
    headers: { authorization: `Bearer ${token}` },
  });

  assert.equal(response.statusCode, 500);
  assert.equal(response.headers["content-type"], "application/problem+json; charset=utf-8");
  assert.equal(response.json().code, "internal_error");
});

test("enforces the project-required X-Request-ID response header", async (t) => {
  const app = await buildApp({
    serviceToken: token,
    handlers: {
      getHealth: () => ({
        statusCode: 200,
        mediaType: "application/json",
        body: { status: "ok", time: time.toISOString() },
      }),
    },
  });
  t.after(() => app.close());

  const response = await app.inject({
    method: "GET",
    url: "/health",
    headers: { authorization: `Bearer ${token}` },
  });

  assert.equal(response.statusCode, 500);
  assert.equal(response.headers["content-type"], "application/problem+json; charset=utf-8");
  assert.match(String(response.headers["x-request-id"]), /^[0-9a-f-]{36}$/);
  assert.equal(response.json().request_id, response.headers["x-request-id"]);
});

test("validates project-required response headers case-insensitively", async (t) => {
  const app = await buildApp({
    serviceToken: token,
    handlers: {
      getHealth: () => ({
        statusCode: 200,
        mediaType: "application/json",
        headers: { "X-Request-ID": "mixed-header-1" },
        body: { status: "ok", time: time.toISOString() },
      }),
    },
  });
  t.after(() => app.close());

  const response = await app.inject({
    method: "GET",
    url: "/health",
    headers: { authorization: `Bearer ${token}` },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["x-request-id"], "mixed-header-1");
});

test("rejects an invalid project-required response header value", async (t) => {
  const app = await buildApp({
    serviceToken: token,
    handlers: {
      getHealth: () => ({
        statusCode: 200,
        mediaType: "application/json",
        headers: { "X-Request-ID": "short" },
        body: { status: "ok", time: time.toISOString() },
      }),
    },
  });
  t.after(() => app.close());

  const response = await app.inject({
    method: "GET",
    url: "/health",
    headers: { authorization: `Bearer ${token}` },
  });

  assert.equal(response.statusCode, 500);
  assert.match(String(response.headers["x-request-id"]), /^[0-9a-f-]{36}$/);
  assert.equal(response.json().code, "internal_error");
});

test("prevents operation overrides from replacing protected response validation", async (t) => {
  const app = await buildApp({
    serviceToken: token,
    handlers: {
      getHealth: () => ({
        statusCode: 200,
        mediaType: "application/json",
        headers: { "x-request-id": "protected-handler-1" },
        body: { status: "ok", time: time.toISOString(), extra: true },
      }),
      postResponseHandler: (_context, _request, reply) => reply.code(200).send({ invalid: true }),
    },
  });
  t.after(() => app.close());

  const response = await app.inject({
    method: "GET",
    url: "/health",
    headers: { authorization: `Bearer ${token}` },
  });

  assert.equal(response.statusCode, 500);
  assert.equal(response.headers["content-type"], "application/problem+json; charset=utf-8");
  assert.equal(response.json().code, "internal_error");
});

test("validates a normalized internal error exactly once against the declared 500 response", async (t) => {
  const validations: Array<{ statusCode: number; mediaType: string; errors: string[] }> = [];
  const app = await buildApp({
    serviceToken: token,
    handlers: {
      getHealth: () => ({
        statusCode: 200,
        mediaType: "application/json",
        headers: { "x-request-id": "normalized-error-1" },
        body: { status: "broken" },
      }),
    },
    testHooks: { onResponseValidation: (event) => validations.push(event) },
  });
  t.after(() => app.close());

  const response = await app.inject({
    method: "GET",
    url: "/health",
    headers: { authorization: `Bearer ${token}`, "x-request-id": "normalized-error-1" },
  });

  assert.equal(response.statusCode, 500);
  assert.equal(response.headers["content-type"], "application/problem+json; charset=utf-8");
  assert.equal(response.headers["x-request-id"], "normalized-error-1");
  assert.equal(response.json().code, "internal_error");
  assert.deepEqual(validations.at(-1), { statusCode: 500, mediaType: "application/problem+json", errors: [] });
  assert.equal(validations.filter((event) => event.statusCode === 500).length, 1);
});

test("uses a secret-free emergency response when the declared internal error is invalid", async (t) => {
  const app = await buildApp({
    serviceToken: token,
    handlers: {
      getHealth: () => ({
        statusCode: 200,
        mediaType: "application/json",
        headers: { "x-request-id": "emergency-error-1" },
        body: { status: "broken" },
      }),
    },
    testHooks: {
      transformInternalError: (response) => ({
        ...response,
        headers: {},
        body: { secret: "must-not-leak" },
      }),
    },
  });
  t.after(() => app.close());

  const response = await app.inject({
    method: "GET",
    url: "/health",
    headers: { authorization: `Bearer ${token}` },
  });

  assert.equal(response.statusCode, 500);
  assert.equal(response.headers["content-type"], "text/plain; charset=utf-8");
  assert.equal(response.headers["x-contract-validation"], "failed");
  assert.match(String(response.headers["x-request-id"]), /^[0-9a-f-]{36}$/);
  assert.equal(response.body, "Internal Server Error");
  assert.equal(response.body.includes("must-not-leak"), false);
});

test("normalizes malformed JSON with the request-id problem boundary", async (t) => {
  const app = await buildApp({ serviceToken: token });
  t.after(() => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/v1/insights/query",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-request-id": "malformed-json-1",
    },
    payload: '{"broken":',
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.headers["content-type"], "application/problem+json; charset=utf-8");
  assert.equal(response.headers["x-request-id"], "malformed-json-1");
  assert.equal(response.json().code, "validation_error");
  assert.equal("error" in response.json(), false);
});

test("normalizes unsupported parser media types without Fastify error fields", async (t) => {
  const app = await buildApp({ serviceToken: token });
  t.after(() => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/v1/insights/query",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/xml",
      "x-request-id": "unsupported-media-1",
    },
    payload: "<query />",
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.headers["content-type"], "application/problem+json; charset=utf-8");
  assert.equal(response.headers["x-request-id"], "unsupported-media-1");
  assert.equal(response.json().code, "validation_error");
  assert.equal("error" in response.json(), false);
});

test("normalizes unsupported methods as 405 without exposing Fastify errors", async (t) => {
  const app = await buildApp({ serviceToken: token });
  t.after(() => app.close());

  const response = await app.inject({
    method: "OPTIONS",
    url: "/health",
    headers: { authorization: `Bearer ${token}`, "x-request-id": "unsupported-method-1" },
  });

  assert.equal(response.statusCode, 405);
  assert.equal(response.headers["content-type"], "application/problem+json; charset=utf-8");
  assert.equal(response.headers["x-request-id"], "unsupported-method-1");
  assert.equal(response.json().code, "method_not_allowed");
});

test("applies OpenAPI 3.1 validation to JSON request bodies", async (t) => {
  const app = await buildApp({ serviceToken: token });
  t.after(() => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/v1/operations",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    payload: {
      type: "configure_monthly_budget",
      client_id: "client-1",
      ad_account_id: "account-1",
      payload: { monthly_budget: { amount: "10.00", currency: "USD" }, extra: true },
    },
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.json().code, "validation_error");
});
