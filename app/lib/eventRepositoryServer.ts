import "server-only";
import { prisma } from "./prisma";
import { createEventRepository } from "./eventRepository";

export const eventRepository = createEventRepository(prisma);
