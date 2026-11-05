import { createAssistantApi } from "../../lib/ai/assistantApi.ts";
import { createAssistantService } from "../../lib/ai/assistantService.ts";
import { eventRepository } from "../../lib/eventRepositoryServer.ts";
import { createConfiguredAssistantProvider } from "../../lib/ai/providerConfig.ts";

export const runtime = "nodejs";
const provider = createConfiguredAssistantProvider(process.env);
const post = createAssistantApi(createAssistantService(provider, { calendarRepository: eventRepository }));

export const POST = post;
