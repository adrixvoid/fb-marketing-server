import multipart from "@fastify/multipart";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import type { Context, HandlerMap } from "openapi-backend";
import { createContract, problem, type ContractResponse } from "./contract.js";
import { RequestContractError } from "./openapi-validation.js";

export type AppOptions = {
  serviceToken: string;
  now?: () => Date;
  handlers?: HandlerMap;
  testHooks?: {
    onResponseValidation?: (event: { statusCode: number; mediaType: string; errors: string[] }) => void;
    transformInternalError?: (response: ContractResponse) => ContractResponse;
  };
};

export async function buildApp({ serviceToken, now = () => new Date(), handlers = {}, testHooks = {} }: AppOptions) {
  const app = Fastify({ logger: false, bodyLimit: 1_048_576 });
  const { api: contract, validators } = await createContract(serviceToken);

  await app.register(multipart, {
    limits: { files: 1, fields: 3, fileSize: 25 * 1024 * 1024 },
  });

  const operationIds = new Set(contract.getOperations().map((operation) => operation.operationId));
  const operationHandlers = Object.fromEntries(
    Object.entries(handlers).filter(([name]) => operationIds.has(name)),
  ) as HandlerMap;
  contract.register({
    getHealth: (context: Context) => {
      const requestId = String(context.request.headers["x-request-id"] ?? crypto.randomUUID());
      return {
        statusCode: 200,
        mediaType: "application/json",
        headers: { "x-request-id": requestId },
        body: { status: "ok", time: now().toISOString() },
      } satisfies ContractResponse;
    },
    stageMedia: (context: Context) =>
      problem(context, 422, "media_invalid", "Unprocessable media", "Multipart media handling is not enabled yet"),
  });
  contract.register(operationHandlers);
  contract.register({
    unauthorizedHandler: (context: Context) => operationProblem(
      context,
      401,
      "unauthorized",
      "Unauthorized",
      "A valid service bearer is required",
    ),
    validationFail: (context: Context) => operationProblem(
      context,
      400,
      "validation_error",
      "Bad request",
      "Request does not match the API contract",
    ),
    notFound: (context: Context) => problem(context, 404, "not_found", "Not found", "Route not found"),
    methodNotAllowed: (context: Context) =>
      problem(context, 405, "method_not_allowed", "Method not allowed", "Method is not allowed for this route"),
    notImplemented: (context: Context) =>
      problem(context, 404, "not_found", "Not found", "Operation is not enabled yet"),
    postResponseHandler: (context: Context, _request: FastifyRequest, reply: FastifyReply) => {
      const response = context.response as ContractResponse;
      const headers = normalizeHeaders(response.headers);
      const mediaType = (headers["content-type"]?.split(";", 1)[0] ?? response.mediaType).trim().toLowerCase();
      const operationId = context.operation?.operationId;
      const errors = operationId
        ? validators.validateResponse(
            operationId,
            response.statusCode,
            mediaType,
            response.body,
            headers,
          )
        : context.operation
          ? [{ keyword: "missingOperationId" }]
          : null;
      testHooks.onResponseValidation?.({
        statusCode: response.statusCode,
        mediaType,
        errors: errors?.map((error) => error.keyword) ?? [],
      });

      if (errors) {
        app.log.error({ operationId: context.operation?.operationId }, "response contract violation");
        return sendValidatedInternalError(
          reply,
          validators,
          operationId,
          requestId(_request.headers["x-request-id"]),
          testHooks,
        );
      }

      return reply.type(mediaType).headers(headers).code(response.statusCode).send(response.body);
    },
  });

  app.setErrorHandler((error, request, reply) => {
    const statusCode =
      typeof error === "object" && error !== null && "statusCode" in error && typeof error.statusCode === "number"
        ? error.statusCode
        : undefined;
    const badRequest =
      error instanceof RequestContractError || (statusCode !== undefined && statusCode >= 400 && statusCode < 500);
    if (!badRequest) {
      const operationId = contract.matchOperation({ method: request.method, path: request.url, headers: {} })?.operationId;
      return sendValidatedInternalError(
        reply,
        validators,
        operationId,
        requestId(request.headers["x-request-id"]),
        testHooks,
      );
    }
    return sendProblem(
      reply,
      requestId(request.headers["x-request-id"]),
      badRequest ? 400 : 500,
      badRequest ? "validation_error" : "internal_error",
      badRequest ? "Bad request" : "Internal Server Error",
    );
  });

  app.addHook("onRequest", async (request, reply) => {
    if (request.ip !== "127.0.0.1") {
      const id = requestId(request.headers["x-request-id"]);
      const url = new URL(request.url, "http://127.0.0.1");
      if (url.pathname === "/v1/capabilities") {
        await sendProblem(reply, id, 403, "forbidden", "Forbidden", suppliedScope(Object.fromEntries(url.searchParams)));
      } else {
        await sendProblem(reply, id, 403, "forbidden", "Forbidden");
      }
    }
  });

  app.route({
    method: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    url: "/*",
    handler: (request, reply) => {
      const headers = Object.fromEntries(
        Object.entries(request.headers).filter((entry): entry is [string, string | string[]] => entry[1] !== undefined),
      );
      return contract.handleRequest(
        {
          method: request.method,
          path: request.url,
          body: request.body,
          query: request.query as Record<string, string | string[]>,
          headers,
        },
        request,
        reply,
      );
    },
  });

  return app;
}

type ContractValidators = Awaited<ReturnType<typeof createContract>>["validators"];

function sendValidatedInternalError(
  reply: FastifyReply,
  validators: ContractValidators,
  operationId: string | undefined,
  id: string,
  testHooks: NonNullable<AppOptions["testHooks"]>,
) {
  const response = testHooks.transformInternalError?.(internalError(id)) ?? internalError(id);
  const headers = normalizeHeaders(response.headers);
  const mediaType = (headers["content-type"]?.split(";", 1)[0] ?? response.mediaType).trim().toLowerCase();
  const errors = operationId
    ? validators.validateResponse(operationId, 500, mediaType, response.body, headers)
    : [{ keyword: "missingOperationId" }];
  testHooks.onResponseValidation?.({
    statusCode: 500,
    mediaType,
    errors: errors?.map((error) => error.keyword) ?? [],
  });

  if (errors) {
    return reply
      .type("text/plain; charset=utf-8")
      .header("x-request-id", id)
      .header("x-contract-validation", "failed")
      .code(500)
      .send("Internal Server Error");
  }

  return reply.type(mediaType).headers(headers).code(500).send(response.body);
}

function internalError(id: string): ContractResponse {
  return {
    statusCode: 500,
    mediaType: "application/problem+json",
    headers: { "x-request-id": id },
    body: {
      type: "urn:fb-marketing-server:internal_error",
      title: "Internal Server Error",
      status: 500,
      code: "internal_error",
      detail: "Internal Server Error",
      request_id: id,
    },
  };
}

function requestId(value: string | string[] | undefined): string {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{8,128}$/.test(value) ? value : crypto.randomUUID();
}

function normalizeHeaders(headers: Record<string, string> | undefined): Record<string, string> {
  return Object.fromEntries(Object.entries(headers ?? {}).map(([name, value]) => [name.toLowerCase(), value]));
}

function suppliedScope(query: Record<string, unknown>): { client_id?: string; ad_account_id?: string } | undefined {
  const supplied = {
    ...(typeof query.client_id === "string" ? { client_id: query.client_id } : {}),
    ...(typeof query.ad_account_id === "string" ? { ad_account_id: query.ad_account_id } : {}),
  };
  return Object.keys(supplied).length === 0 ? undefined : supplied;
}

function operationProblem(context: Context, status: number, code: string, title: string, detail: string): ContractResponse {
  const response = problem(context, status, code, title, detail);
  if (context.operation?.operationId !== "getCapabilities") return response;
  const supplied = suppliedScope(context.request.query as Record<string, unknown>);
  return supplied === undefined ? response : { ...response, body: { ...(response.body as object), supplied_scope: supplied } };
}

function sendProblem(
  reply: FastifyReply,
  id: string,
  status: number,
  code: string,
  title: string,
  supplied?: { client_id?: string; ad_account_id?: string },
) {
  return reply
    .type("application/problem+json")
    .header("x-request-id", id)
    .code(status)
    .send({
      type: `urn:fb-marketing-server:${code}`,
      title,
      status,
      code,
      detail: title,
      request_id: id,
      ...(supplied === undefined ? {} : { supplied_scope: supplied }),
    });
}
