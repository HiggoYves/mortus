import { eventRepository } from "../../../lib/eventRepositoryServer";
import { createEventApi } from "../../../lib/eventApi";

export const runtime = "nodejs";
const api = createEventApi(eventRepository);

export const GET = api.get;
export const PATCH = api.update;
export const DELETE = api.remove;
