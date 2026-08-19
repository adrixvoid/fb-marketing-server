import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

type JsonObject = Record<string, unknown>;
type OpenApiDocument = JsonObject & {
  components?: { schemas?: Record<string, JsonObject> };
  paths?: Record<string, Record<string, JsonObject>>;
};

const COMPONENTS_ID = "urn:fb-marketing-server:openapi-components";
const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "head", "options", "trace"]);

export class RequestContractError extends Error {}

export function createAjv2020() {
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false, strictTypes: false });
  (addFormats as unknown as (instance: Ajv2020) => void)(ajv);
  ajv.addFormat("binary", true);
  ajv.addKeyword({ keyword: "discriminator", schemaType: "object" });
  return ajv;
}

function rewriteRefs(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(rewriteRefs);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      key === "$ref" && typeof child === "string" && child.startsWith("#/components/schemas/")
        ? `${COMPONENTS_ID}#/$defs/${child.slice("#/components/schemas/".length)}`
        : rewriteRefs(child),
    ]),
  );
}

function resolveLocalRef(document: JsonObject, value: unknown): JsonObject {
  let current = value;
  const seen = new Set<string>();
  while (current && typeof current === "object" && "$ref" in current) {
    const ref = (current as JsonObject).$ref;
    if (typeof ref !== "string" || !ref.startsWith("#/") || seen.has(ref)) {
      throw new Error(`Unsupported or circular OpenAPI object reference: ${String(ref)}`);
    }
    seen.add(ref);
    current = ref
      .slice(2)
      .split("/")
      .map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"))
      .reduce<unknown>((target, part) => (target as JsonObject)?.[part], document);
  }
  if (!current || typeof current !== "object") throw new Error("OpenAPI reference did not resolve to an object");
  return current as JsonObject;
}

function contentSchemas(document: JsonObject, container: unknown): Record<string, JsonObject> {
  const resolved = resolveLocalRef(document, container);
  const content = resolved.content;
  if (!content || typeof content !== "object") return {};
  return Object.fromEntries(
    Object.entries(content as JsonObject).flatMap(([mediaType, media]) => {
      const schema = media && typeof media === "object" ? (media as JsonObject).schema : undefined;
      return schema && typeof schema === "object" ? [[mediaType, schema as JsonObject]] : [];
    }),
  );
}

export function compileOpenApiSchemas(document: OpenApiDocument) {
  const ajv = createAjv2020();
  const schemas = document.components?.schemas ?? {};
  ajv.addSchema({ $id: COMPONENTS_ID, $defs: rewriteRefs(schemas) });
  for (const name of Object.keys(schemas)) {
    if (!ajv.getSchema(`${COMPONENTS_ID}#/$defs/${name}`)) throw new Error(`Could not compile schema ${name}`);
  }

  const requests = new Map<string, ValidateFunction>();
  const responses = new Map<string, ValidateFunction>();
  const responseHeaders = new Map<string, Array<{ name: string; required: boolean; validate?: ValidateFunction }>>();
  for (const pathItem of Object.values(document.paths ?? {})) {
    for (const [method, candidate] of Object.entries(pathItem)) {
      if (!HTTP_METHODS.has(method) || !candidate || typeof candidate !== "object") continue;
      const operationId = candidate.operationId;
      if (typeof operationId !== "string") throw new Error(`OpenAPI ${method} operation is missing operationId`);

      if (candidate.requestBody) {
        for (const [mediaType, schema] of Object.entries(contentSchemas(document, candidate.requestBody))) {
          requests.set(`${operationId}:${mediaType}`, ajv.compile(rewriteRefs(schema) as JsonObject));
        }
      }

      const operationResponses = candidate.responses;
      if (!operationResponses || typeof operationResponses !== "object") {
        throw new Error(`OpenAPI operation ${operationId} has no responses`);
      }
      for (const [status, response] of Object.entries(operationResponses as JsonObject)) {
        const resolvedResponse = resolveLocalRef(document, response);
        const declaredHeaders = resolvedResponse.headers;
        responseHeaders.set(
          `${operationId}:${status}`,
          declaredHeaders && typeof declaredHeaders === "object"
            ? Object.entries(declaredHeaders as JsonObject).map(([name, header]) => {
                const definition = resolveLocalRef(document, header);
                const schema = definition.schema;
                return {
                  name: name.toLowerCase(),
                  // OAS response headers are optional by default; this contract explicitly requires correlation IDs.
                  required: definition.required === true,
                  ...(schema && typeof schema === "object"
                    ? { validate: ajv.compile(rewriteRefs(schema) as JsonObject) }
                    : {}),
                };
              })
            : [],
        );
        for (const [mediaType, schema] of Object.entries(contentSchemas(document, response))) {
          responses.set(`${operationId}:${status}:${mediaType}`, ajv.compile(rewriteRefs(schema) as JsonObject));
        }
      }
    }
  }

  return {
    validateJsonRequest(operationId: string, body: unknown): ErrorObject[] | null {
      const validate = requests.get(`${operationId}:application/json`);
      if (!validate || !validate(body)) return validate?.errors ?? [{ keyword: "missingSchema" } as ErrorObject];
      return null;
    },
    validateResponse(
      operationId: string,
      status: number,
      mediaType: string,
      body: unknown,
      headers: Record<string, string>,
    ): ErrorObject[] | null {
      const validate = responses.get(`${operationId}:${status}:${mediaType}`);
      const errors = !validate || !validate(body) ? [...(validate?.errors ?? [{ keyword: "missingSchema" } as ErrorObject])] : [];
      const declaredHeaders = responseHeaders.get(`${operationId}:${status}`);
      if (!declaredHeaders) errors.push({ keyword: "missingHeaderSchema" } as ErrorObject);
      for (const header of declaredHeaders ?? []) {
        const value = headers[header.name];
        if (header.required && value === undefined) errors.push({ keyword: "requiredResponseHeader" } as ErrorObject);
        else if (value !== undefined && header.validate && !header.validate(value)) {
          errors.push(...(header.validate.errors ?? [{ keyword: "invalidResponseHeader" } as ErrorObject]));
        }
      }
      return errors.length ? errors : null;
    },
  };
}
