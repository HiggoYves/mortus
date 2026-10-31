import { eventRepository } from "../../lib/eventRepositoryServer";
import { createEventApi } from "../../lib/eventApi";

export const runtime = "nodejs";
const api = createEventApi(eventRepository);

export const GET = api.list;
export const POST = api.create;
