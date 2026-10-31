"use server";

import { headers } from "next/headers";
import { eventRepository } from "../lib/eventRepositoryServer";
import { createEventMigrationService } from "../lib/eventMigrationService";

const migrationService = createEventMigrationService(eventRepository);

export async function importEventsToSqlite(value: unknown) {
  const requestHeaders = await headers();
  return migrationService.importEvents(value, requestHeaders.get("origin"), requestHeaders.get("host"));
}
