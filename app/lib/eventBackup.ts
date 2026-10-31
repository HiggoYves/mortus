import { isCalendarEventList } from "./events.ts";
import type { CalendarEvent } from "./events.ts";

export const EVENT_BACKUP_VERSION = 1;
const MAX_BACKUP_SIZE = 5 * 1024 * 1024;

export type EventBackup = {
  version: typeof EVENT_BACKUP_VERSION;
  exportedAt: string;
  events: CalendarEvent[];
};

export function createEventBackup(events: CalendarEvent[], exportedAt = new Date()): string {
  if (!isCalendarEventList(events)) throw new Error("A lista atual contém eventos inválidos e não pode ser exportada.");
  const backup: EventBackup = { version: EVENT_BACKUP_VERSION, exportedAt: exportedAt.toISOString(), events };
  return JSON.stringify(backup, null, 2);
}

export function parseEventBackup(contents: string): EventBackup {
  if (contents.length > MAX_BACKUP_SIZE) throw new Error("O arquivo excede o limite de 5 MB.");

  let value: unknown;
  try {
    value = JSON.parse(contents);
  } catch {
    throw new Error("O arquivo não contém JSON válido.");
  }

  if (typeof value !== "object" || value === null) throw new Error("A estrutura do backup é inválida.");
  const backup = value as Record<string, unknown>;
  if (backup.version !== EVENT_BACKUP_VERSION || typeof backup.exportedAt !== "string" || !Number.isFinite(Date.parse(backup.exportedAt)) || new Date(backup.exportedAt).toISOString() !== backup.exportedAt) {
    throw new Error("Formato de backup incompatível. Selecione um arquivo JSON exportado pelo Mortus.");
  }
  if (!isCalendarEventList(backup.events)) {
    throw new Error("O backup contém eventos inválidos. Nenhum evento foi importado.");
  }

  return { version: EVENT_BACKUP_VERSION, exportedAt: backup.exportedAt, events: backup.events };
}
