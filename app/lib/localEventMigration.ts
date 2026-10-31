import { migrateCalendarEventList } from "./events.ts";
import type { CalendarEvent } from "./events.ts";
import { demoEvents, separateDemoEvents } from "./demoEvents.ts";

export type LocalMigrationSource = {
  sourceEvents: CalendarEvent[];
  eventsToMigrate: CalendarEvent[];
  demoCount: number;
};

export function parseLocalMigrationSource(raw: string | null): LocalMigrationSource | null {
  if (raw === null) return { sourceEvents: [], eventsToMigrate: [], demoCount: demoEvents.length };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const sourceEvents = migrateCalendarEventList(parsed);
  if (sourceEvents === null) return null;

  const split = separateDemoEvents(sourceEvents);
  return { sourceEvents, eventsToMigrate: split.events, demoCount: split.demoCount };
}
