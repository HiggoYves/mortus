import { migrateCalendarEventList } from "./events.ts";
import { isAllowedLocalRequest } from "./localRequestSecurity.ts";
import { EventBatchImportValidationError } from "./eventRepository.ts";
import type { EventBatchImportSummary } from "./eventRepository.ts";

export type EventMigrationResult =
  | { ok: true; summary: EventBatchImportSummary }
  | { ok: false; reason: "forbidden" | "invalid" | "conflict" | "internal"; summary?: EventBatchImportSummary };

type ImportRepository = {
  importBatch(value: unknown): Promise<EventBatchImportSummary>;
};

export function createEventMigrationService(repository: ImportRepository) {
  return {
    async importEvents(value: unknown, origin: string | null, host: string | null): Promise<EventMigrationResult> {
      if (!isAllowedLocalRequest(origin, host, true)) return { ok: false, reason: "forbidden" };
      const events = migrateCalendarEventList(value);
      if (events === null) return { ok: false, reason: "invalid" };

      try {
        const summary = await repository.importBatch(events);
        return summary.conflicts > 0
          ? { ok: false, reason: "conflict", summary }
          : { ok: true, summary };
      } catch (error) {
        return error instanceof EventBatchImportValidationError
          ? { ok: false, reason: "invalid" }
          : { ok: false, reason: "internal" };
      }
    },
  };
}
