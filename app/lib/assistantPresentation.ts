import { isCalendarEvent, isValidDate, type CalendarEvent } from "./events.ts";

export type AssistantPresentation =
  | { kind: "events"; from: string; to: string; events: CalendarEvent[]; truncated: boolean }
  | { kind: "summary"; from: string; to: string; eventCount: number; byDate: { date: string; count: number }[]; byCategory: { category: string; count: number }[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validRange(data: Record<string, unknown>): data is Record<string, unknown> & { from: string; to: string } {
  return isValidDate(data.from) && isValidDate(data.to) && data.from <= data.to;
}

function isCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

export function parseAssistantPresentation(intent: unknown, value: unknown): AssistantPresentation | null {
  if (!isRecord(value) || !validRange(value)) return null;

  if (intent === "calendar_events" && Array.isArray(value.events) && typeof value.truncated === "boolean" && value.events.every(isCalendarEvent)) {
    return {
      kind: "events",
      from: value.from,
      to: value.to,
      events: value.events,
      truncated: value.truncated,
    };
  }

  if (intent === "agenda_summary" && isCount(value.eventCount) && Array.isArray(value.byDate) && Array.isArray(value.byCategory)) {
    const byDate = value.byDate.filter((entry): entry is { date: string; count: number } =>
      isRecord(entry) && isValidDate(entry.date) && isCount(entry.count));
    const byCategory = value.byCategory.filter((entry): entry is { category: string; count: number } =>
      isRecord(entry) && typeof entry.category === "string" && isCount(entry.count));

    if (byDate.length !== value.byDate.length || byCategory.length !== value.byCategory.length) return null;
    return { kind: "summary", from: value.from, to: value.to, eventCount: value.eventCount, byDate, byCategory };
  }

  return null;
}

export function formatAssistantDate(value: string): string {
  if (!isValidDate(value)) return value;
  return new Date(`${value}T12:00:00`).toLocaleDateString("pt-BR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function assistantHttpErrorMessage(status: number, code: string | null): string {
  if (code === "PROVIDER_TIMEOUT") return "O assistente demorou para responder. Tente novamente.";
  if (code === "PROVIDER_RATE_LIMITED" || code === "USAGE_LIMIT_EXCEEDED") return "O limite de consultas foi atingido. Aguarde um pouco e tente novamente.";
  if (code === "CALENDAR_UNAVAILABLE") return "Não foi possível consultar a agenda agora. Seus eventos continuam preservados.";
  if (code === "PROVIDER_NOT_CONFIGURED") return "O assistente ainda não está configurado neste servidor.";
  if (status === 429) return "O limite de consultas foi atingido. Aguarde um pouco e tente novamente.";
  if (status >= 500) return "O assistente está indisponível no momento. Tente novamente mais tarde.";
  if (status === 400) return "Não consegui entender essa consulta. Confira a mensagem e tente novamente.";
  return "Não foi possível enviar sua mensagem. Tente novamente.";
}
