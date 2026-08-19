import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("generation retains OpenAPI types and only authoritative runtime options", async () => {
  const [types, options] = await Promise.all([
    readFile(new URL("../src/generated/openapi.d.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/generated/contract-options.ts", import.meta.url), "utf8"),
  ]);

  assert.match(types, /export interface paths/);
  assert.match(types, /availability: "available"/);
  assert.match(types, /availability: "unavailable"/);
  assert.match(options, /CAMPAIGN_KINDS/);
  assert.doesNotMatch(options, /TOOL_SCHEMAS/);
});
