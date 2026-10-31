export const EVENT_STORAGE_KEY = "mortus.calendar.events.v1";

export const eventCategories = ["Trabalho", "Pessoal", "Saúde"] as const;

export type EventCategory = (typeof eventCategories)[number];

export type CalendarEvent = {
  id: number;
  title: string;
  date: string;
  endDate: string;
  startTime: string;
  endTime: string;
  category: EventCategory;
};

export type EventConflict = {
  first: CalendarEvent;
  second: CalendarEvent;
};

export type EventDraft = Omit<CalendarEvent, "id">;

export function createCalendarEvent(events: CalendarEvent[], draft: EventDraft, id = Date.now()): CalendarEvent[] {
  const event: CalendarEvent = { ...draft, id };
  if (!isCalendarEvent(event) || events.some((item) => item.id === id)) return events;
  return [...events, event];
}

export function updateCalendarEvent(events: CalendarEvent[], id: number, draft: EventDraft): CalendarEvent[] {
  if (!events.some((event) => event.id === id)) return events;
  const updated: CalendarEvent = { ...draft, id };
  if (!isCalendarEvent(updated)) return events;
  return events.map((event) => event.id === id ? updated : event);
}

export function deleteCalendarEvent(events: CalendarEvent[], id: number): CalendarEvent[] {
  return events.filter((event) => event.id !== id);
}

function isValidDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function timeToMinutes(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

export function isValidTime(value: unknown): value is string {
  if (typeof value !== "string") return false;

  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return false;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours <= 23 && minutes <= 59;
}

export function validateEventTimeRange(startDate: string, startTime: string, endDate: string, endTime: string): string | null {
  if (!isValidTime(startTime) || !isValidTime(endTime)) {
    return "Informe horários válidos para início e término.";
  }
  if (!isValidDate(startDate) || !isValidDate(endDate)) return "Informe datas válidas para início e término.";
  const start = new Date(`${startDate}T${startTime}:00.000Z`).getTime();
  const end = new Date(`${endDate}T${endTime}:00.000Z`).getTime();
  if (end <= start) {
    return "O horário de término deve ser posterior ao início.";
  }
  return null;
}

export function isCalendarEvent(value: unknown): value is CalendarEvent {
  if (typeof value !== "object" || value === null) return false;

  const event = value as Record<string, unknown>;
  return (
    Number.isSafeInteger(event.id) &&
    typeof event.title === "string" &&
    event.title.trim().length > 0 &&
    isValidDate(event.date) &&
    isValidDate(event.endDate) &&
    isValidTime(event.startTime) &&
    isValidTime(event.endTime) &&
    validateEventTimeRange(event.date, event.startTime, event.endDate, event.endTime) === null &&
    eventCategories.includes(event.category as EventCategory)
  );
}

function migrateCalendarEvent(value: unknown): CalendarEvent | null {
  if (isCalendarEvent(value)) return value;
  if (typeof value !== "object" || value === null) return null;

  const legacyEvent = value as Record<string, unknown>;
  const startTime = legacyEvent.startTime ?? legacyEvent.time;
  if (
    !Number.isSafeInteger(legacyEvent.id) ||
    typeof legacyEvent.title !== "string" ||
    legacyEvent.title.trim().length === 0 ||
    !isValidDate(legacyEvent.date) ||
    !isValidTime(startTime) ||
    !eventCategories.includes(legacyEvent.category as EventCategory)
  ) {
    return null;
  }

  const durationEnd = legacyEvent.endTime === undefined ? timeToMinutes(startTime) + 60 : timeToMinutes(isValidTime(legacyEvent.endTime) ? legacyEvent.endTime as string : "00:00");
  const inferredOvernight = legacyEvent.endDate === undefined && (durationEnd >= 1440 || durationEnd <= timeToMinutes(startTime));
  const endTime = legacyEvent.endTime === undefined ? minutesToTime(durationEnd % 1440) : legacyEvent.endTime;
  const endDate = legacyEvent.endDate ?? (inferredOvernight ? shiftDate(legacyEvent.date as string, 1) : legacyEvent.date);
  if (!isValidTime(endTime) || !isValidDate(endDate)) return null;
  const migratedEvent: CalendarEvent = {
    id: legacyEvent.id as number,
    title: legacyEvent.title,
    date: legacyEvent.date,
    endDate,
    startTime,
    endTime,
    category: legacyEvent.category as EventCategory,
  };

  return isCalendarEvent(migratedEvent) ? migratedEvent : null;
}

function shiftDate(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function minutesToTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

export function migrateCalendarEventList(value: unknown): CalendarEvent[] | null {
  if (!Array.isArray(value)) return null;

  const migratedEvents = value.map(migrateCalendarEvent);
  if (migratedEvents.some((event) => event === null)) return null;

  const events = migratedEvents as CalendarEvent[];
  const ids = new Set(events.map((event) => event.id));
  return ids.size === events.length ? events : null;
}

export function isCalendarEventList(value: unknown): value is CalendarEvent[] {
  return Array.isArray(value) && value.every(isCalendarEvent) && new Set(value.map((event) => event.id)).size === value.length;
}

export function findEventConflicts(events: CalendarEvent[]): EventConflict[] {
  const conflicts: EventConflict[] = [];

  for (let firstIndex = 0; firstIndex < events.length; firstIndex += 1) {
    const first = events[firstIndex];
    for (let secondIndex = firstIndex + 1; secondIndex < events.length; secondIndex += 1) {
      const second = events[secondIndex];
      const firstStart = new Date(`${first.date}T${first.startTime}:00.000Z`).getTime();
      const firstEnd = new Date(`${first.endDate}T${first.endTime}:00.000Z`).getTime();
      const secondStart = new Date(`${second.date}T${second.startTime}:00.000Z`).getTime();
      const secondEnd = new Date(`${second.endDate}T${second.endTime}:00.000Z`).getTime();
      const overlaps = firstStart < secondEnd && secondStart < firstEnd;
      if (overlaps) conflicts.push({ first, second });
    }
  }

  return conflicts;
}
