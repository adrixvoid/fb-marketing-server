import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parse } from "yaml";

test("every centralized operation declares the reusable internal error response", async () => {
  const document = parse(await readFile(new URL("../openapi.yaml", import.meta.url), "utf8")) as {
    paths: Record<string, Record<string, { responses: Record<string, unknown> }>>;
    components: {
      responses: {
        InternalError: {
          headers: Record<string, unknown>;
          content: Record<string, { schema: unknown }>;
        };
      };
      schemas: { Problem500: { allOf: Array<{ properties?: { code?: { const?: string } } }> } };
    };
  };
  const operations = Object.values(document.paths).flatMap((pathItem) =>
    Object.entries(pathItem)
      .filter(([method]) => ["get", "post", "put", "patch", "delete"].includes(method))
      .map(([, operation]) => operation),
  );

  assert.equal(operations.length > 0, true);
  for (const operation of operations) {
    assert.deepEqual(operation.responses["500"], { $ref: "#/components/responses/InternalError" });
  }

  const response = document.components.responses.InternalError;
  assert.deepEqual(response.headers["X-Request-ID"], { $ref: "#/components/headers/RequestId" });
  const problemContent = response.content["application/problem+json"];
  assert.ok(problemContent);
  assert.deepEqual(problemContent.schema, {
    $ref: "#/components/schemas/Problem500",
  });
  const specialization = document.components.schemas.Problem500.allOf[1];
  assert.ok(specialization?.properties?.code);
  assert.equal(specialization.properties.code.const, "internal_error");
});
