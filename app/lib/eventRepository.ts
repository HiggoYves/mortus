import { randomBytes } from "node:crypto";
import type { PrismaClient } from "../generated/prisma/client";
import { isCalendarEvent, isCalendarEventList, isValidDate, isValidEventDraft } from "./events.ts";
import type { CalendarEvent, EventDraft } from "./events.ts";

const EVENT_ID_NAMESPACE_START = 2 ** 52;
const MAX_ID_ALLOCATION_ATTEMPTS = 8;

export type EventDateRange = {
  from?: unknown;
  to?: unknown;
};

export class EventRepositoryValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EventRepositoryValidationError";
  }
}

export class EventRepositoryDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EventRepositoryDataError";
  }
}

export class EventIdAllocationError extends Error {
  constructor() {
    super("Não foi possível gerar um ID único para o evento. Tente novamente.");
    this.name = "EventIdAllocationError";
  }
}

export type EventBatchImportSummary = {
  received: number;
  imported: number;
  alreadyExisting: number;
  conflicts: number;
};

export class EventBatchImportValidationError extends Error {
  constructor() {
    super("A lista de eventos contém dados inválidos ou campos não suportados.");
    this.name = "EventBatchImportValidationError";
  }
}

class EventBatchImportConflict extends Error {
  readonly summary: EventBatchImportSummary;

  constructor(summary: EventBatchImportSummary) {
    super("Um evento com o mesmo ID e conteúdo diferente já existe.");
    this.name = "EventBatchImportConflict";
    this.summary = summary;
  }
}

type PersistedEvent = {
  id: bigint;
  title: string;
  date: string;
  endDate: string;
  startTime: string;
  endTime: string;
  category: string;
};

type ValidatedDateRange = {
  from?: string;
  to?: string;
};

type EventRepositoryOptions = {
  generateId?: () => number;
};

function generateEventId(): number {
  // Historical IDs are small seeds or Date.now() timestamps; new IDs use a separate safe-integer range.
  return EVENT_ID_NAMESPACE_START + randomBytes(4).readUInt32BE(0);
}

function assertEventId(value: unknown): bigint {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new EventRepositoryValidationError("O ID do evento deve ser um inteiro seguro.");
  }
  return BigInt(value);
}

function assertEventDraft(value: unknown): EventDraft {
  if (!isValidEventDraft(value)) {
    throw new EventRepositoryValidationError("Os dados do evento são inválidos.");
  }

  return {
    title: value.title,
    date: value.date,
    endDate: value.endDate,
    startTime: value.startTime,
    endTime: value.endTime,
    category: value.category,
  };
}

function validateDateRange(value: unknown = {}): ValidatedDateRange {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new EventRepositoryValidationError("O intervalo de datas deve ser um objeto válido.");
  }
  const range = value as EventDateRange;
  const result: ValidatedDateRange = {};
  if (range.from !== undefined) {
    if (!isValidDate(range.from)) throw new EventRepositoryValidationError("A data inicial do intervalo é inválida.");
    result.from = range.from;
  }
  if (range.to !== undefined) {
    if (!isValidDate(range.to)) throw new EventRepositoryValidationError("A data final do intervalo é inválida.");
    result.to = range.to;
  }
  if (result.from !== undefined && result.to !== undefined && result.from > result.to) {
    throw new EventRepositoryValidationError("A data inicial do intervalo deve ser anterior ou igual à data final.");
  }
  return result;
}

function toCalendarEvent(event: PersistedEvent): CalendarEvent {
  const id = Number(event.id);
  const candidate = {
    id,
    title: event.title,
    date: event.date,
    endDate: event.endDate,
    startTime: event.startTime,
    endTime: event.endTime,
    category: event.category,
  };
  if (!Number.isSafeInteger(id) || !isCalendarEvent(candidate)) {
    throw new EventRepositoryDataError("O banco contém um evento incompatível com o modelo do Mortus.");
  }
  return candidate;
}

function hasPrismaErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

function validateImportEvents(value: unknown): CalendarEvent[] {
  const fields = new Set(["id", "title", "date", "endDate", "startTime", "endTime", "category"]);
  if (!isCalendarEventList(value) || value.some((event) => Object.keys(event).some((key) => !fields.has(key)))) {
    throw new EventBatchImportValidationError();
  }
  return value;
}

function sameEventContent(existing: PersistedEvent, incoming: CalendarEvent): boolean {
  return existing.title === incoming.title &&
    existing.date === incoming.date &&
    existing.endDate === incoming.endDate &&
    existing.startTime === incoming.startTime &&
    existing.endTime === incoming.endTime &&
    existing.category === incoming.category;
}

export function createEventRepository(client: PrismaClient, options: EventRepositoryOptions = {}) {
  const nextId = options.generateId ?? generateEventId;

  async function create(value: unknown): Promise<CalendarEvent> {
    const draft = assertEventDraft(value);

    for (let attempt = 0; attempt < MAX_ID_ALLOCATION_ATTEMPTS; attempt += 1) {
      const id = nextId();
      const databaseId = assertEventId(id);
      const existing = await client.event.findUnique({ where: { id: databaseId }, select: { id: true } });
      if (existing) continue;

      try {
        const event = await client.event.create({ data: { id: databaseId, ...draft } });
        return toCalendarEvent(event);
      } catch (error) {
        if (hasPrismaErrorCode(error, "P2002")) continue;
        throw error;
      }
    }

    throw new EventIdAllocationError();
  }

  async function list(range: unknown = {}): Promise<CalendarEvent[]> {
    const { from, to } = validateDateRange(range);
    const events = await client.event.findMany({
      where: {
        ...(to === undefined ? {} : { date: { lte: to } }),
        ...(from === undefined ? {} : { endDate: { gte: from } }),
      },
      orderBy: [{ date: "asc" }, { startTime: "asc" }, { id: "asc" }],
    });
    return events.map(toCalendarEvent);
  }

  async function getById(value: unknown): Promise<CalendarEvent | null> {
    const id = assertEventId(value);
    const event = await client.event.findUnique({ where: { id } });
    return event === null ? null : toCalendarEvent(event);
  }

  async function update(value: unknown, draftValue: unknown): Promise<CalendarEvent | null> {
    const id = assertEventId(value);
    const draft = assertEventDraft(draftValue);
    try {
      const event = await client.event.update({ where: { id }, data: draft });
      return toCalendarEvent(event);
    } catch (error) {
      if (hasPrismaErrorCode(error, "P2025")) return null;
      throw error;
    }
  }

  async function remove(value: unknown): Promise<boolean> {
    const id = assertEventId(value);
    const result = await client.event.deleteMany({ where: { id } });
    return result.count === 1;
  }

  async function importBatch(value: unknown): Promise<EventBatchImportSummary> {
    // Validate the complete batch before opening a transaction or querying for writes.
    const events = validateImportEvents(value);
    let imported = 0;
    let alreadyExisting = 0;
    const received = events.length;

    try {
      return await client.$transaction(async (transaction) => {
        const pending: CalendarEvent[] = [];
        let conflicts = 0;
        for (const event of events) {
          const id = BigInt(event.id);
          const existing = await transaction.event.findUnique({ where: { id } });
          if (existing) {
            if (sameEventContent(existing, event)) {
              alreadyExisting += 1;
            } else {
              conflicts += 1;
            }
          } else {
            pending.push(event);
          }
        }

        if (conflicts > 0) {
          // Throwing from the interactive transaction aborts the whole import.
          throw new EventBatchImportConflict({ received, imported: 0, alreadyExisting, conflicts });
        }

        for (const event of pending) {
          await transaction.event.create({
            data: {
              id: BigInt(event.id),
              title: event.title,
              date: event.date,
              endDate: event.endDate,
              startTime: event.startTime,
              endTime: event.endTime,
              category: event.category,
            },
          });
          imported += 1;
        }
        return { received, imported, alreadyExisting, conflicts: 0 };
      });
    } catch (error) {
      if (error instanceof EventBatchImportConflict) return error.summary;
      throw error;
    }
  }

  return { create, list, getById, update, remove, importBatch };
}
