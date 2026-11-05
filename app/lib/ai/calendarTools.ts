import { isValidDate } from "../events.ts";
import type { CalendarEvent } from "../events.ts";
import { AssistantError, type ReadOnlyCalendarToolName } from "./types.ts";

export const MAX_CALENDAR_TOOL_RANGE_DAYS = 31;
export const MAX_CALENDAR_TOOL_EVENTS = 100;
const FETCH_LIMIT = MAX_CALENDAR_TOOL_EVENTS + 1;

export type CalendarReadRepository = {
  list(range: { from: string; to: string }, limit?: number): Promise<CalendarEvent[]>;
};

export type CalendarToolArguments = { from: string; to: string };

function validateArguments(value: unknown): CalendarToolArguments {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new AssistantError("INVALID_TOOL_REQUEST", "Os argumentos da consulta devem ser um objeto.");
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 2 || !("from" in record) || !("to" in record) ||
      !isValidDate(record.from) || !isValidDate(record.to)) {
    throw new AssistantError("INVALID_TOOL_REQUEST", "Informe somente datas válidas nos campos from e to (AAAA-MM-DD).");
  }
  const from = record.from;
  const to = record.to;
  if (from > to) {
    throw new AssistantError("INVALID_TOOL_REQUEST", "A data inicial deve ser anterior ou igual à data final.");
  }
  const dayCount = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
  if (dayCount > MAX_CALENDAR_TOOL_RANGE_DAYS) {
    throw new AssistantError("INVALID_TOOL_REQUEST", `O intervalo máximo de consulta é ${MAX_CALENDAR_TOOL_RANGE_DAYS} dias.`);
  }
  return { from, to };
}

function summarize(events: CalendarEvent[], from: string, to: string) {
  const byDate = new Map<string, number>();
  const byCategory = new Map<string, number>();
  for (const event of events) {
    byDate.set(event.date, (byDate.get(event.date) ?? 0) + 1);
    byCategory.set(event.category, (byCategory.get(event.category) ?? 0) + 1);
  }
  return {
    from,
    to,
    eventCount: events.length,
    byDate: [...byDate].sort(([first], [second]) => first.localeCompare(second)).map(([date, count]) => ({ date, count })),
    byCategory: [...byCategory].sort(([first], [second]) => first.localeCompare(second)).map(([category, count]) => ({ category, count })),
  };
}

export async function executeCalendarReadTool(
  name: string,
  rawArguments: unknown,
  repository: CalendarReadRepository,
): Promise<{ intent: "calendar_events" | "agenda_summary"; message: string; data: unknown }> {
  if (name !== "list_events" && name !== "get_agenda_summary") {
    throw new AssistantError("INVALID_TOOL_REQUEST", "A ferramenta solicitada não está disponível.");
  }
  const { from, to } = validateArguments(rawArguments);
  let events: CalendarEvent[];
  try {
    events = await repository.list({ from, to }, FETCH_LIMIT);
  } catch {
    throw new AssistantError("CALENDAR_UNAVAILABLE", "Não foi possível consultar o calendário. Tente novamente mais tarde.");
  }

  if (name === "list_events") {
    const truncated = events.length > MAX_CALENDAR_TOOL_EVENTS;
    const result = { from, to, events: events.slice(0, MAX_CALENDAR_TOOL_EVENTS), truncated };
    return {
      intent: "calendar_events",
      message: truncated
        ? `Encontrei mais de ${MAX_CALENDAR_TOOL_EVENTS} eventos no intervalo. Exibo os primeiros ${MAX_CALENDAR_TOOL_EVENTS}; reduza o período para ver os demais.`
        : `Encontrei ${events.length} evento(s) entre ${from} e ${to}.`,
      data: result,
    };
  }

  if (events.length > MAX_CALENDAR_TOOL_EVENTS) {
    throw new AssistantError("INVALID_TOOL_REQUEST", `O resumo excederia o limite de ${MAX_CALENDAR_TOOL_EVENTS} eventos. Consulte um intervalo menor.`);
  }
  const summary = summarize(events, from, to);
  return {
    intent: "agenda_summary",
    message: `Resumo de ${from} a ${to}: ${summary.eventCount} evento(s).`,
    data: summary,
  };
}
