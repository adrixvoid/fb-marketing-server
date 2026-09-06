import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import type { AuditEvent } from "../src/db.js";
import { MetaError, createMetaClient, type MetaScope } from "../src/meta-client.js";

const scope: MetaScope = {
  clientId: "client-1",
  adAccountId: "act_1",
  generationId: "generation-1",
};

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json", ...init.headers },
    ...init,
  });
}

function client(fetch: typeof globalThis.fetch, overrides: Record<string, unknown> = {}) {
  const audits: AuditEvent[] = [];
  const sleeps: number[] = [];
  let credentialReads = 0;
  const instance = createMetaClient({
    fetch,
    getCredentials: async () => {
      credentialReads += 1;
      return { accessToken: "TOKEN-CANARY", appSecret: "APP-SECRET-CANARY" };
    },
    audit: async (event) => audits.push(event),
    now: () => new Date("2026-08-19T12:00:00.000Z"),
    sleep: async (milliseconds) => {
      sleeps.push(milliseconds);
    },
    random: () => 0,
    timeoutMs: 50,
    maxAttempts: 3,
    maxPages: 3,
    maxPolls: 3,
    ...overrides,
  });
  return { instance, audits, sleeps, credentialReads: () => credentialReads };
}

test("Meta reads pin v26.0, confine credentials, capture rate evidence, and audit each attempt", async () => {
  const calls: Array<{ url: string; authorization: string | null }> = [];
  const fixture = client(async (input, init) => {
    calls.push({ url: String(input), authorization: new Headers(init?.headers).get("authorization") });
    return json(
      { data: [{ id: "campaign-1" }] },
      {
        headers: {
          "x-fb-request-id": "meta-request-1",
          "x-app-usage": '{"call_count":12}',
          "x-ad-account-usage": '{"acc_id_util_pct":7}',
        },
      },
    );
  });

  const result = await fixture.instance.request<{ data: Array<{ id: string }> }>({
    method: "GET",
    path: "/act_1/campaigns",
    query: { fields: "id,name", limit: 25 },
    scope,
    actor: "openclaw:owner-1",
    correlationId: "request-1234",
    operation: "list_campaigns",
  });

  assert.deepEqual(result.data, { data: [{ id: "campaign-1" }] });
  assert.deepEqual(result.rate, { appUsage: { call_count: 12 }, adAccountUsage: { acc_id_util_pct: 7 } });
  assert.equal(calls[0]!.authorization, "Bearer TOKEN-CANARY");
  const url = new URL(calls[0]!.url);
  assert.equal(`${url.origin}${url.pathname}`, "https://graph.facebook.com/v26.0/act_1/campaigns");
  assert.equal(url.searchParams.get("access_token"), null);
  assert.equal(
    url.searchParams.get("appsecret_proof"),
    createHmac("sha256", "APP-SECRET-CANARY").update("TOKEN-CANARY").digest("hex"),
  );
  assert.equal(fixture.credentialReads(), 1);
  assert.deepEqual(
    fixture.audits.map(({ outcome, evidence }) => ({ outcome, evidence })),
    [
      { outcome: "started", evidence: {} },
      { outcome: "succeeded", evidence: { externalRequestId: "meta-request-1", httpStatus: 200 } },
    ],
  );
  assert.doesNotMatch(JSON.stringify({ result, audits: fixture.audits }), /TOKEN-CANARY|APP-SECRET-CANARY|authorization/i);
});

test("Meta requests reject credential-shaped query parameters before dispatch", async () => {
  let dispatched = false;
  const fixture = client(async () => {
    dispatched = true;
    return json({ ok: true });
  });
  await assert.rejects(
    fixture.instance.request({
      method: "GET",
      path: "/act_1/campaigns",
      query: { access_token: "QUERY-TOKEN-CANARY" },
      scope,
      actor: "owner",
      correlationId: "request-1234",
      operation: "list_campaigns",
    }),
    /reserved Meta query parameter/i,
  );
  assert.equal(dispatched, false);
  assert.equal(fixture.credentialReads(), 0);
});

test("Meta writes preserve multipart media bodies without forcing a JSON content type", async () => {
  let sentUrl = "";
  let sentBody: BodyInit | null | undefined;
  let contentType: string | null = "missing";
  const fixture = client(async (input, init) => {
    sentUrl = String(input);
    sentBody = init?.body;
    contentType = new Headers(init?.headers).get("content-type");
    return json({ id: "video-1" });
  });
  const form = new FormData();
  form.append("source", new Blob([Buffer.from("video-bytes")], { type: "video/mp4" }), "creative.mp4");

  await fixture.instance.request({
    method: "POST", path: "/act_1/advideos", form, scope, actor: "owner",
    correlationId: "request-video-upload", operation: "execute_video",
  });

  assert.equal(sentBody, form);
  assert.equal(contentType, null);
  assert.equal(new URL(sentUrl).searchParams.get("appsecret_proof"), null);
  assert.equal(form.get("appsecret_proof"), createHmac("sha256", "APP-SECRET-CANARY").update("TOKEN-CANARY").digest("hex"));
  assert.equal(form.get("access_token"), null);
});

test("Meta JSON writes use form fields and keep credentials out of the URL and audit", async () => {
  let sentUrl = "";
  let sentBody: BodyInit | null | undefined;
  const fixture = client(async (input, init) => {
    sentUrl = String(input);
    sentBody = init?.body;
    return json({ id: "campaign-1" });
  });

  await fixture.instance.request({
    method: "POST", path: "/act_1/campaigns", body: { name: "Campaign", status: "PAUSED", special_ad_categories: [] },
    scope, actor: "owner", correlationId: "request-campaign", operation: "execute_campaign",
  });

  assert.ok(sentBody instanceof FormData);
  assert.equal(sentBody.get("name"), "Campaign");
  assert.equal(sentBody.get("status"), "PAUSED");
  assert.equal(sentBody.get("special_ad_categories"), "[]");
  assert.equal(new URL(sentUrl).searchParams.size, 0);
  assert.equal(sentBody.get("appsecret_proof"), createHmac("sha256", "APP-SECRET-CANARY").update("TOKEN-CANARY").digest("hex"));
  assert.doesNotMatch(JSON.stringify(fixture.audits), /TOKEN-CANARY|APP-SECRET-CANARY|appsecret_proof|authorization/i);
});

test("Meta reads use Retry-After for bounded transient retries while writes are never retried", async () => {
  let reads = 0;
  const readFixture = client(async () => {
    reads += 1;
    return reads === 1
      ? json({ error: { message: "raw secret TOKEN-CANARY", code: 4 } }, { status: 429, headers: { "retry-after": "2" } })
      : json({ ok: true });
  });
  const read = await readFixture.instance.request<{ ok: boolean }>({
    method: "GET",
    path: "/act_1/campaigns",
    scope,
    actor: "owner",
    correlationId: "request-1234",
    operation: "list_campaigns",
  });
  assert.deepEqual(read.data, { ok: true });
  assert.equal(reads, 2);
  assert.deepEqual(readFixture.sleeps, [2_000]);
  assert.deepEqual(readFixture.audits.map(({ outcome }) => outcome), ["started", "failed", "started", "succeeded"]);

  let writes = 0;
  const writeFixture = client(async () => {
    writes += 1;
    return json({ error: { message: "temporary", is_transient: true } }, { status: 503 });
  });
  await assert.rejects(
    writeFixture.instance.request({
      method: "POST",
      path: "/act_1/insights",
      body: { async: true },
      scope,
      actor: "owner",
      correlationId: "request-5678",
      operation: "create_insights_job",
    }),
    (error: unknown) => error instanceof MetaError && error.status === 503 && !String(error).includes("temporary"),
  );
  assert.equal(writes, 1);
  assert.deepEqual(writeFixture.sleeps, []);
});

test("Meta failures normalize malformed bodies and abort timed-out requests without leaking bodies", async () => {
  const malformed = client(async () => new Response("TOKEN-CANARY <html>", { status: 502 }));
  let failure: unknown;
  try {
    await malformed.instance.request({
      method: "POST",
      path: "/act_1/insights",
      scope,
      actor: "owner",
      correlationId: "request-1234",
      operation: "create_insights_job",
    });
  } catch (error) {
    failure = error;
  }
  assert.ok(failure instanceof MetaError);
  assert.equal(failure.status, 502);
  assert.doesNotMatch(JSON.stringify(failure), /TOKEN-CANARY|html/i);

  let observedAbort = false;
  const timed = client(
    async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => {
            observedAbort = true;
            reject(new DOMException("TOKEN-CANARY", "AbortError"));
          },
          { once: true },
        );
      }),
    { timeoutMs: 10, maxAttempts: 1 },
  );
  await assert.rejects(
    timed.instance.request({
      method: "GET",
      path: "/act_1/campaigns",
      scope,
      actor: "owner",
      correlationId: "request-1234",
      operation: "list_campaigns",
    }),
    (error: unknown) => error instanceof MetaError && error.code === "timeout",
  );
  assert.equal(observedAbort, true);
  assert.deepEqual(timed.audits.map(({ outcome }) => outcome), ["started", "failed"]);
});

test("Meta timeout remains active while a response body is being consumed", async () => {
  let bodyCancelled = false;
  const fixture = client(
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("BODY-SECRET-CANARY"));
          },
          cancel() {
            bodyCancelled = true;
          },
        }),
        { status: 502 },
      ),
    { timeoutMs: 10, maxAttempts: 1 },
  );
  let failure: unknown;
  try {
    await fixture.instance.request({
      method: "GET",
      path: "/act_1/campaigns",
      scope,
      actor: "owner",
      correlationId: "request-body-timeout",
      operation: "list_campaigns",
    });
  } catch (error) {
    failure = error;
  }
  assert.ok(failure instanceof MetaError);
  assert.equal(failure.code, "timeout");
  assert.equal(bodyCancelled, true);
  assert.doesNotMatch(JSON.stringify(failure), /BODY-SECRET-CANARY/);
  assert.deepEqual(fixture.audits.map(({ outcome }) => outcome), ["started", "failed"]);

  const lateHeaders = client(
    async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return new Response(new ReadableStream({ start() {} }), { status: 502 });
    },
    { timeoutMs: 5, maxAttempts: 1 },
  );
  const outcome = await Promise.race([
    lateHeaders.instance.request({
      method: "GET",
      path: "/act_1/campaigns",
      scope,
      actor: "owner",
      correlationId: "request-late-headers",
      operation: "list_campaigns",
    }).then(() => "resolved", (error: unknown) => error instanceof MetaError ? error.code : "wrong-error"),
    new Promise<string>((resolve) => setTimeout(() => resolve("hung"), 100)),
  ]);
  assert.equal(outcome, "timeout");
});

test("transient Meta error envelopes retry safe GET 400 responses but not nontransient GETs or POSTs", async () => {
  let transientGets = 0;
  const transient = client(async () => {
    transientGets += 1;
    return transientGets === 1
      ? json({ error: { code: 1, is_transient: true, message: "TRANSIENT-SECRET-CANARY" } }, { status: 400 })
      : json({ ok: true });
  });
  assert.deepEqual(
    (await transient.instance.request<{ ok: boolean }>({
      method: "GET",
      path: "/act_1/campaigns",
      scope,
      actor: "owner",
      correlationId: "request-transient-get",
      operation: "list_campaigns",
    })).data,
    { ok: true },
  );
  assert.equal(transientGets, 2);

  let nontransientGets = 0;
  const nontransient = client(async () => {
    nontransientGets += 1;
    return json({ error: { code: 100, is_transient: false } }, { status: 400 });
  });
  await assert.rejects(
    nontransient.instance.request({
      method: "GET",
      path: "/act_1/campaigns",
      scope,
      actor: "owner",
      correlationId: "request-nontransient-get",
      operation: "list_campaigns",
    }),
    (error: unknown) => error instanceof MetaError && error.status === 400 && error.transient === false,
  );
  assert.equal(nontransientGets, 1);

  let transientPosts = 0;
  const post = client(async () => {
    transientPosts += 1;
    return json({ error: { code: 1, is_transient: true } }, { status: 400 });
  });
  await assert.rejects(
    post.instance.request({
      method: "POST",
      path: "/act_1/insights",
      scope,
      actor: "owner",
      correlationId: "request-transient-post",
      operation: "query_insights",
    }),
    (error: unknown) => error instanceof MetaError && error.transient === true,
  );
  assert.equal(transientPosts, 1);
});

test("pagination follows bounded opaque cursors and rejects repeated cursors", async () => {
  const seen: Array<string | null> = [];
  const fixture = client(async (input) => {
    const after = new URL(String(input)).searchParams.get("after");
    seen.push(after);
    return after === null
      ? json({ data: [{ id: "1" }], paging: { cursors: { after: "cursor-2" }, next: "https://evil.invalid/token" } })
      : json({ data: [{ id: "2" }], paging: {} });
  });
  const items = await fixture.instance.paginate<{ id: string }>({
    path: "/act_1/campaigns",
    scope,
    actor: "owner",
    correlationId: "request-1234",
    operation: "list_campaigns",
  });
  assert.deepEqual(items, [{ id: "1" }, { id: "2" }]);
  assert.deepEqual(seen, [null, "cursor-2"]);
  assert.equal(fixture.audits.length, 4);

  const looping = client(async () => json({ data: [{ id: "1" }], paging: { cursors: { after: "same" } } }));
  await assert.rejects(
    looping.instance.paginate({
      path: "/act_1/campaigns",
      scope,
      actor: "owner",
      correlationId: "request-5678",
      operation: "list_campaigns",
    }),
    /repeated cursor/i,
  );
});

test("async Insights creates once, polls within bounds, and retrieves every result page", async () => {
  const calls: Array<{ method: string; path: string }> = [];
  let polls = 0;
  const fixture = client(async (input, init) => {
    const url = new URL(String(input));
    calls.push({ method: init?.method ?? "GET", path: url.pathname });
    if (init?.method === "POST") return json({ report_run_id: "job-1" });
    if (url.pathname.endsWith("/job-1")) {
      polls += 1;
      return json({ async_status: polls === 1 ? "Job Running" : "Job Completed" });
    }
    return url.searchParams.get("after") === null
      ? json({ data: [{ id: "row-1" }], paging: { cursors: { after: "next" } } })
      : json({ data: [], paging: {} });
  });

  const rows = await fixture.instance.runAsyncInsights<{ id: string }>({
    path: "/act_1/insights",
    query: { fields: "spend,impressions" },
    scope,
    actor: "owner",
    correlationId: "request-1234",
    operation: "query_insights",
  });
  assert.deepEqual(rows, [{ id: "row-1" }]);
  assert.equal(calls.filter(({ method }) => method === "POST").length, 1);
  assert.deepEqual(calls.map(({ path }) => path), [
    "/v26.0/act_1/insights",
    "/v26.0/job-1",
    "/v26.0/job-1",
    "/v26.0/job-1/insights",
    "/v26.0/job-1/insights",
  ]);
  assert.equal(fixture.audits.length, 10);

  const unfinished = client(async (_input, init) =>
    init?.method === "POST" ? json({ report_run_id: "job-2" }) : json({ async_status: "Job Running" }),
  );
  await assert.rejects(
    unfinished.instance.runAsyncInsights({
      path: "/act_1/insights",
      scope,
      actor: "owner",
      correlationId: "request-5678",
      operation: "query_insights",
    }),
    /poll limit/i,
  );
});
