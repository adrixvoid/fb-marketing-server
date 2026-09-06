import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { OpenAPIBackend, type Context } from "openapi-backend";
import addFormats from "ajv-formats";
import { parse } from "yaml";
import { compileOpenApiSchemas, RequestContractError } from "./openapi-validation.js";
import { requestId } from "./request-id.js";

export type ContractResponse = {
  statusCode: number;
  mediaType: "application/json" | "application/problem+json";
  body: unknown;
  headers?: Record<string, string>;
};

const openapiPath = resolve(import.meta.dirname, "../openapi.yaml");

function equalToken(actual: string | undefined, expected: string): boolean {
  if (!actual?.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(actual.slice(7));
  const wanted = Buffer.from(expected);
  return supplied.length === wanted.length && timingSafeEqual(supplied, wanted);
}

export async function createContract(serviceToken: string) {
  if (!serviceToken) throw new Error("A service bearer token is required");

  const definition = parse(await readFile(openapiPath, "utf8"));
  const validators = compileOpenApiSchemas(definition);
  const api = new OpenAPIBackend({
    definition,
    strict: true,
    // openapi-backend remains routing/security plumbing; AJV 2020 validates the 3.1 contract.
    quick: true,
    customizeAjv: (ajv) => {
      (addFormats as unknown as (instance: typeof ajv) => void)(ajv);
      ajv.addFormat("binary", true);
      return ajv;
    },
    // Multipart bytes stay streamed. The media handler validates that boundary itself.
    validate: (context: Context) => context.operation.operationId !== "stageMedia",
  });

  api.registerSecurityHandler("ServiceBearer", (context: Context) =>
    equalToken(context.request.headers.authorization, serviceToken),
  );
  api.register("preOperationHandler", (context: Context) => {
    if (context.operation.operationId === "stageMedia") return;
    if (!context.operation.operationId) throw new RequestContractError("OpenAPI operationId is required");
    if (context.request.headers["content-type"]?.split(";", 1)[0] === "application/json") {
      const errors = validators.validateJsonRequest(context.operation.operationId, context.request.body);
      if (errors) throw new RequestContractError("JSON request does not match the OpenAPI 3.1 schema");
    }
  });
  await api.init();
  return { api, validators };
}

export function problem(
  context: Context,
  statusCode: number,
  code: string,
  title: string,
  detail: string,
): ContractResponse {
  const id = requestId(context.request.headers["x-request-id"]);
  return {
    statusCode,
    mediaType: "application/problem+json",
    headers: {
      "x-request-id": id,
      ...(statusCode === 401 ? { "www-authenticate": "Bearer" } : {}),
    },
    body: {
      type: `urn:fb-marketing-server:${code}`,
      title,
      status: statusCode,
      code,
      detail,
      request_id: id,
    },
  };
}
