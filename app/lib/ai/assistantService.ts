import { AssistantError, type AssistantProvider, type AssistantResult } from "./types.ts";
import { executeCalendarReadTool, type CalendarReadRepository } from "./calendarTools.ts";

export const MAX_ASSISTANT_MESSAGE_LENGTH = 2000;
export const ASSISTANT_TIMEOUT_MS = 5000;

export type AssistantServiceOptions = {
  timeoutMs?: number;
  maxMessageLength?: number;
  calendarRepository?: CalendarReadRepository;
};

export function createAssistantService(provider: AssistantProvider, options: AssistantServiceOptions = {}) {
  const timeoutMs = options.timeoutMs ?? ASSISTANT_TIMEOUT_MS;
  const maxMessageLength = options.maxMessageLength ?? MAX_ASSISTANT_MESSAGE_LENGTH;

  async function respond(input: unknown): Promise<AssistantResult> {
    if (typeof input !== "string" || input.trim().length === 0) {
      throw new AssistantError("INVALID_MESSAGE", "Envie uma mensagem de texto não vazia.");
    }
    const message = input.trim();
    if (message.length > maxMessageLength) {
      throw new AssistantError("MESSAGE_TOO_LONG", `A mensagem deve ter no máximo ${maxMessageLength} caracteres.`);
    }

    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(new AssistantError("PROVIDER_TIMEOUT", "O assistente demorou demais para responder. Tente novamente."));
      }, timeoutMs);
    });

    try {
      const response = await Promise.race([
        provider.respond({ message, signal: controller.signal }).catch((error: unknown) => {
          if (error instanceof AssistantError) throw error;
          throw new AssistantError("PROVIDER_UNAVAILABLE", "O assistente está indisponível no momento. Tente novamente mais tarde.");
        }),
        timeoutPromise,
      ]);
      if (response.toolCall === undefined) {
        return { ...response, provider: provider.name };
      }
      if (!options.calendarRepository) {
        throw new AssistantError("CALENDAR_UNAVAILABLE", "As consultas do calendário não estão disponíveis.");
      }
      const result = await executeCalendarReadTool(
        response.toolCall.name,
        response.toolCall.arguments,
        options.calendarRepository,
      );
      return { ...result, provider: provider.name };
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  return { respond };
}
