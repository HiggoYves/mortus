import type { CalendarEvent, EventDraft } from "./events.ts";
import {
  EventIdAllocationError,
  EventRepositoryValidationError,
} from "./eventRepository.ts";
import { isAllowedLocalRequest } from "./localRequestSecurity.ts";

const EVENT_FIELDS = new Set(["title", "date", "endDate", "startTime", "endTime", "category"]);

type EventRepositoryApi = {
  create(value: unknown): Promise<CalendarEvent>;
  list(range?: unknown): Promise<CalendarEvent[]>;
  getById(id: unknown): Promise<CalendarEvent | null>;
  update(id: unknown, draft: unknown): Promise<CalendarEvent | null>;
  remove(id: unknown): Promise<boolean>;
};

type RouteContext = { params: Promise<{ id: string }> };

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function localRequestError(request: Request, write: boolean): Response | null {
  return isAllowedLocalRequest(request.headers.get("origin"), request.headers.get("host"), write)
    ? null
    : json({ error: "Origem local não permitida." }, 403);
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readObject(request: Request): Promise<Record<string, unknown> | Response> {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    return json({ error: "O corpo deve conter JSON válido." }, 400);
  }
  if (!isJsonObject(value)) return json({ error: "O corpo deve ser um objeto JSON." }, 400);
  if (Object.keys(value).some((key) => !EVENT_FIELDS.has(key))) {
    return json({ error: "O corpo contém campos não permitidos." }, 400);
  }
  return value;
}

function parseId(value: string): number | null {
  if (!/^(?:0|[1-9]\d*|-[1-9]\d*)$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

function handleError(error: unknown): Response {
  if (error instanceof EventRepositoryValidationError) return json({ error: error.message }, 400);
  if (error instanceof EventIdAllocationError) return json({ error: "Conflito ao alocar um ID de evento. Tente novamente." }, 409);
  return json({ error: "Erro interno ao processar o evento." }, 500);
}

export function createEventApi(repository: EventRepositoryApi) {
  async function list(request: Request): Promise<Response> {
    const rejected = localRequestError(request, false);
    if (rejected) return rejected;

    try {
      const url = new URL(request.url);
      if ([...url.searchParams.keys()].some((key) => key !== "from" && key !== "to")) {
        return json({ error: "Filtros de consulta não permitidos." }, 400);
      }
      if (url.searchParams.getAll("from").length > 1 || url.searchParams.getAll("to").length > 1) {
        return json({ error: "Informe cada filtro de data uma única vez." }, 400);
      }
      const range = {
        ...(url.searchParams.has("from") ? { from: url.searchParams.get("from") } : {}),
        ...(url.searchParams.has("to") ? { to: url.searchParams.get("to") } : {}),
      };
      return json(await repository.list(range));
    } catch (error) {
      return handleError(error);
    }
  }

  async function create(request: Request): Promise<Response> {
    const rejected = localRequestError(request, true);
    if (rejected) return rejected;

    const body = await readObject(request);
    if (body instanceof Response) return body;
    try {
      const event = await repository.create(body as EventDraft);
      return json(event, 201);
    } catch (error) {
      return handleError(error);
    }
  }

  async function get(request: Request, context: RouteContext): Promise<Response> {
    const rejected = localRequestError(request, false);
    if (rejected) return rejected;
    const { id: rawId } = await context.params;
    const id = parseId(rawId);
    if (id === null) return json({ error: "ID de evento inválido." }, 400);
    try {
      const event = await repository.getById(id);
      return event ? json(event) : json({ error: "Evento não encontrado." }, 404);
    } catch (error) {
      return handleError(error);
    }
  }

  async function update(request: Request, context: RouteContext): Promise<Response> {
    const rejected = localRequestError(request, true);
    if (rejected) return rejected;
    const { id: rawId } = await context.params;
    const id = parseId(rawId);
    if (id === null) return json({ error: "ID de evento inválido." }, 400);

    const body = await readObject(request);
    if (body instanceof Response) return body;
    try {
      const current = await repository.getById(id);
      if (!current) return json({ error: "Evento não encontrado." }, 404);
      const draft = {
        title: current.title,
        date: current.date,
        endDate: current.endDate,
        startTime: current.startTime,
        endTime: current.endTime,
        category: current.category,
        ...body,
      };
      const event = await repository.update(id, draft);
      return event ? json(event) : json({ error: "Evento não encontrado." }, 404);
    } catch (error) {
      return handleError(error);
    }
  }

  async function remove(request: Request, context: RouteContext): Promise<Response> {
    const rejected = localRequestError(request, true);
    if (rejected) return rejected;
    const { id: rawId } = await context.params;
    const id = parseId(rawId);
    if (id === null) return json({ error: "ID de evento inválido." }, 400);
    try {
      return await repository.remove(id)
        ? new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } })
        : json({ error: "Evento não encontrado." }, 404);
    } catch (error) {
      return handleError(error);
    }
  }

  return { list, create, get, update, remove };
}
