import { isCalendarEvent, isCalendarEventList } from "./events.ts";
import type { CalendarEvent, EventDraft } from "./events.ts";

export const SQLITE_MODE_STORAGE_KEY = "mortus.persistence.mode.v1";
export const SQLITE_MODE_VALUE = "sqlite";

export class EventApiClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EventApiClientError";
  }
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(path, { ...init, cache: "no-store", credentials: "same-origin" });
  } catch {
    throw new EventApiClientError("Não foi possível conectar ao banco. Os dados locais foram mantidos.");
  }
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const value: unknown = await response.json();
    if (typeof value === "object" && value !== null && "error" in value && typeof value.error === "string") {
      return value.error;
    }
  } catch {
    // Use the generic status message below for non-JSON server responses.
  }
  return `A operação no banco falhou (HTTP ${response.status}).`;
}

export async function fetchSqliteEvents(): Promise<CalendarEvent[]> {
  const response = await request("/api/events");
  if (!response.ok) throw new EventApiClientError(await errorMessage(response));
  const events: unknown = await response.json();
  if (!isCalendarEventList(events)) throw new EventApiClientError("O banco retornou uma lista de eventos incompatível.");
  return events;
}

async function writeEvent(path: string, method: "POST" | "PATCH", draft: EventDraft): Promise<CalendarEvent> {
  const response = await request(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(draft),
  });
  if (!response.ok) throw new EventApiClientError(await errorMessage(response));
  const event: unknown = await response.json();
  if (!isCalendarEvent(event)) throw new EventApiClientError("O servidor retornou um evento incompatível.");
  return event;
}

export function createSqliteEvent(draft: EventDraft): Promise<CalendarEvent> {
  return writeEvent("/api/events", "POST", draft);
}

export function updateSqliteEvent(id: number, draft: EventDraft): Promise<CalendarEvent> {
  return writeEvent(`/api/events/${id}`, "PATCH", draft);
}

export async function deleteSqliteEvent(id: number): Promise<void> {
  const response = await request(`/api/events/${id}`, { method: "DELETE" });
  if (!response.ok) throw new EventApiClientError(await errorMessage(response));
}

export function sameEvent(first: CalendarEvent, second: CalendarEvent): boolean {
  return first.id === second.id && first.title === second.title && first.date === second.date &&
    first.endDate === second.endDate && first.startTime === second.startTime &&
    first.endTime === second.endTime && first.category === second.category;
}

export function containsEvents(databaseEvents: CalendarEvent[], expectedEvents: CalendarEvent[]): boolean {
  const byId = new Map(databaseEvents.map((event) => [event.id, event]));
  return expectedEvents.every((event) => {
    const saved = byId.get(event.id);
    return saved !== undefined && sameEvent(saved, event);
  });
}
