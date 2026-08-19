import assert from "node:assert/strict";
import test from "node:test";
import { compileOpenApiSchemas, createAjv2020 } from "../src/openapi-validation.js";

test("enforces draft 2020 unevaluatedProperties closure", () => {
  const validate = createAjv2020().compile({
    type: "object",
    allOf: [{ type: "object", properties: { status: { const: "ok" } }, required: ["status"] }],
    unevaluatedProperties: false,
  });

  assert.equal(validate({ status: "ok" }), true);
  assert.equal(validate({ status: "ok", extra: true }), false);
  assert.equal(validate.errors?.[0]?.keyword, "unevaluatedProperties");
});

test("does not silently ignore unknown schema formats", () => {
  const ajv = createAjv2020();
  assert.throws(() => ajv.compile({ type: "string", format: "unknown-contract-format" }), /unknown format/);
});

test("compiles and enforces a 2020 JSON request-body schema", () => {
  const validators = compileOpenApiSchemas({
    openapi: "3.1.1",
    components: { schemas: {} },
    paths: {
      "/items": {
        post: {
          operationId: "createItem",
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  allOf: [{ properties: { name: { type: "string" } }, required: ["name"] }],
                  unevaluatedProperties: false,
                },
              },
            },
          },
          responses: {
            "204": { description: "Created" },
          },
        },
      },
    },
  });

  assert.equal(validators.validateJsonRequest("createItem", { name: "Ada" }), null);
  assert.equal(validators.validateJsonRequest("createItem", { name: "Ada", extra: true })?.[0]?.keyword, "unevaluatedProperties");
});
