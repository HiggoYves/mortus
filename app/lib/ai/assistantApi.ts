import { AssistantError, type AssistantErrorCode } from "./types.ts";
import { isAllowedLocalRequest } from "../localRequestSecurity.ts";

export const MAX_ASSISTANT_BODY_BYTES = 8192;

type AssistantService = { respond(input: unknown): Promise<unknown> };

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function errorResponse(error: unknown): Response {
  if (error instanceof AssistantError) {
    const status = error.code === "INVALID_MESSAGE" || error.code === "MESSAGE_TOO_LONG" || error.code === "INVALID_TOOL_REQUEST" ? 400
      : error.code === "PROVIDER_TIMEOUT" ? 504
        : error.code === "PROVIDER_RATE_LIMITED" || error.code === "USAGE_LIMIT_EXCEEDED" ? 429
          : error.code === "PROVIDER_INVALID_RESPONSE" || error.code === "PROVIDER_MODEL_NOT_FOUND" || error.code === "PROVIDER_REQUEST_REJECTED" ? 502
            : error.code === "PROVIDER_INTERNAL_ERROR" ? 500 : 503;
    return json({ error: { code: error.code, message: error.message } }, status);
  }
  return json({ error: { code: "PROVIDER_UNAVAILABLE" satisfies AssistantErrorCode, message: "O assistente está indisponível no momento." } }, 503);
}

export function createAssistantApi(service: AssistantService) {
  return async function post(request: Request): Promise<Response> {
    if (!isAllowedLocalRequest(request.headers.get("origin"), request.headers.get("host"), true)) {
      return json({ error: { code: "LOCAL_ORIGIN_REQUIRED", message: "Origem local não permitida." } }, 403);
    }

    const contentLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_ASSISTANT_BODY_BYTES) {
      return json({ error: { code: "BODY_TOO_LARGE", message: "O corpo da solicitação excede o limite permitido." } }, 413);
    }

    let rawBody: string;
    try {
      rawBody = await request.text();
    } catch {
      return json({ error: { code: "INVALID_BODY", message: "Não foi possível ler o corpo da solicitação." } }, 400);
    }
    if (new TextEncoder().encode(rawBody).byteLength > MAX_ASSISTANT_BODY_BYTES) {
      return json({ error: { code: "BODY_TOO_LARGE", message: "O corpo da solicitação excede o limite permitido." } }, 413);
    }

    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return json({ error: { code: "INVALID_BODY", message: "Envie um objeto JSON válido." } }, 400);
    }
    if (typeof body !== "object" || body === null || Array.isArray(body) || Object.keys(body).length !== 1 || !("message" in body)) {
      return json({ error: { code: "INVALID_BODY", message: "O corpo deve conter somente o campo message." } }, 400);
    }

    try {
      return json({ data: await service.respond((body as { message: unknown }).message) });
    } catch (error) {
      return errorResponse(error);
    }
  };
}
