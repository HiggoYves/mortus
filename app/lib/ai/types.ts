export type AssistantIntent = "greeting" | "calendar_help" | "unknown" | "calendar_events" | "agenda_summary";

export type AssistantToolCall = {
  name: string;
  arguments: unknown;
};

export type AssistantProviderResponse = {
  message: string;
  intent: AssistantIntent;
  toolCall?: AssistantToolCall;
};

export type AssistantResult = {
  message: string;
  intent: AssistantIntent;
  provider: string;
  data?: unknown;
};

export type AssistantProviderRequest = {
  message: string;
  signal: AbortSignal;
};

export interface AssistantProvider {
  readonly name: string;
  respond(request: AssistantProviderRequest): Promise<AssistantProviderResponse>;
}

export type ReadOnlyCalendarToolName = "list_events" | "get_agenda_summary";

/** Reserved tool contract. This stage declares read-only capabilities only. */
export type ReadOnlyCalendarTool = {
  name: ReadOnlyCalendarToolName;
  description: string;
  input: {
    type: "object";
    properties: { from: { type: "string" }; to: { type: "string" } };
    required: readonly ["from", "to"];
    additionalProperties: false;
  };
};

export const assistantReadOnlyTools: readonly ReadOnlyCalendarTool[] = [
  {
    name: "list_events",
    description: "Consulta eventos do calendário dentro de um intervalo de datas.",
    input: {
      type: "object",
      properties: { from: { type: "string" }, to: { type: "string" } },
      required: ["from", "to"],
      additionalProperties: false,
    },
  },
  {
    name: "get_agenda_summary",
    description: "Solicita um resumo diário ou semanal de um intervalo de datas.",
    input: {
      type: "object",
      properties: { from: { type: "string" }, to: { type: "string" } },
      required: ["from", "to"],
      additionalProperties: false,
    },
  },
];

export type AssistantErrorCode = "INVALID_MESSAGE" | "MESSAGE_TOO_LONG" | "PROVIDER_TIMEOUT" | "PROVIDER_UNAVAILABLE" | "PROVIDER_NOT_CONFIGURED" | "PROVIDER_INVALID_RESPONSE" | "PROVIDER_RATE_LIMITED" | "PROVIDER_AUTH_FAILED" | "PROVIDER_MODEL_NOT_FOUND" | "PROVIDER_NETWORK_ERROR" | "PROVIDER_REQUEST_REJECTED" | "PROVIDER_INTERNAL_ERROR" | "USAGE_LIMIT_EXCEEDED" | "INVALID_TOOL_REQUEST" | "CALENDAR_UNAVAILABLE";

export class AssistantError extends Error {
  readonly code: AssistantErrorCode;

  constructor(code: AssistantErrorCode, message: string) {
    super(message);
    this.name = "AssistantError";
    this.code = code;
  }
}
