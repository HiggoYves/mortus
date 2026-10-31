import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../app/generated/prisma/client.ts";
import { createEventMigrationService } from "../app/lib/eventMigrationService.ts";
import { createEventRepository } from "../app/lib/eventRepository.ts";

const migrationSql = readFileSync(new URL("../prisma/migrations/20261031211833_init/migration.sql", import.meta.url), "utf8");
const draft = {
  id: 1_730_000_000_111,
  title: "Migração controlada",
  date: "2026-10-31",
  endDate: "2026-11-01",
  startTime: "23:30",
  endTime: "00:30",
  category: "Pessoal",
};

let temporaryDirectory;
let databasePath;
let client;
let repository;
let service;

beforeEach(() => {
  temporaryDirectory = mkdtempSync(join(tmpdir(), "mortus-migration-service-test-"));
  databasePath = join(temporaryDirectory, "isolated.db");
  const sqlite = new Database(databasePath);
  try {
    sqlite.exec(migrationSql);
  } finally {
    sqlite.close();
  }
  client = new PrismaClient({
    adapter: new PrismaBetterSqlite3({ url: `file:${databasePath.replaceAll("\\", "/")}` }),
  });
  repository = createEventRepository(client);
  service = createEventMigrationService(repository);
});

afterEach(async () => {
  if (client) await client.$disconnect();
  if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true });
});

test("bloqueia importação sem Origin, em origem externa ou Host incompatível", async () => {
  assert.deepEqual(await service.importEvents([draft], null, "127.0.0.1:3000"), { ok: false, reason: "forbidden" });
  assert.deepEqual(await service.importEvents([draft], "https://attacker.example", "127.0.0.1:3000"), { ok: false, reason: "forbidden" });
  assert.deepEqual(await service.importEvents([draft], "http://localhost:3000", "127.0.0.1:3000"), { ok: false, reason: "forbidden" });
  assert.deepEqual(await repository.list(), []);
});

test("importa lote válido somente por origem local correspondente e preserva evento noturno", async () => {
  const result = await service.importEvents([draft], "http://127.0.0.1:3000", "127.0.0.1:3000");
  assert.deepEqual(result, { ok: true, summary: { received: 1, imported: 1, alreadyExisting: 0, conflicts: 0 } });
  assert.deepEqual(await repository.getById(draft.id), draft);

  const testPortDraft = { ...draft, id: draft.id + 1 };
  assert.deepEqual(
    await service.importEvents([testPortDraft], "http://127.0.0.1:3002", "127.0.0.1:3002"),
    { ok: true, summary: { received: 1, imported: 1, alreadyExisting: 0, conflicts: 0 } },
  );
  assert.deepEqual(await repository.getById(testPortDraft.id), testPortDraft);
});

test("mapeia lista inválida e conflito sem sobrescrever banco", async () => {
  assert.deepEqual(await service.importEvents([{ ...draft, endDate: draft.date, endTime: "22:00" }], "http://127.0.0.1:3000", "127.0.0.1:3000"), {
    ok: false, reason: "invalid",
  });
  const existing = { ...draft, title: "Conteúdo mantido" };
  await client.event.create({ data: { ...existing, id: BigInt(existing.id) } });
  assert.deepEqual(await service.importEvents([{ ...draft, title: "Conteúdo conflitante" }], "http://127.0.0.1:3000", "127.0.0.1:3000"), {
    ok: false,
    reason: "conflict",
    summary: { received: 1, imported: 0, alreadyExisting: 0, conflicts: 1 },
  });
  assert.deepEqual(await repository.getById(existing.id), existing);
});

test("retorna falha genérica quando a persistência falha", async () => {
  const brokenService = createEventMigrationService({ importBatch: async () => { throw new Error("private database detail"); } });
  assert.deepEqual(await brokenService.importEvents([draft], "http://127.0.0.1:3000", "127.0.0.1:3000"), {
    ok: false, reason: "internal",
  });
});
