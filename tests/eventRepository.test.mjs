import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../app/generated/prisma/client.ts";
import {
  createEventRepository,
  EventIdAllocationError,
  EventRepositoryValidationError,
} from "../app/lib/eventRepository.ts";
import { createEventBackup, parseEventBackup } from "../app/lib/eventBackup.ts";

const migrationSql = readFileSync(new URL("../prisma/migrations/20261031211833_init/migration.sql", import.meta.url), "utf8");
const ID_NAMESPACE_START = 2 ** 52;
const draft = {
  title: "Planejamento",
  date: "2026-11-01",
  endDate: "2026-11-01",
  startTime: "09:00",
  endTime: "10:00",
  category: "Trabalho",
};

let temporaryDirectory;
let databasePath;
let client;
let repository;

function openTestClient(path) {
  const adapter = new PrismaBetterSqlite3({ url: `file:${path.replaceAll("\\", "/")}` });
  return new PrismaClient({ adapter });
}

beforeEach(() => {
  temporaryDirectory = mkdtempSync(join(tmpdir(), "mortus-events-test-"));
  databasePath = join(temporaryDirectory, "isolated.db");
  const sqlite = new Database(databasePath);
  try {
    sqlite.exec(migrationSql);
  } finally {
    sqlite.close();
  }
  client = openTestClient(databasePath);
  repository = createEventRepository(client);
});

afterEach(async () => {
  if (client) await client.$disconnect();
  if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true });
});

test("cria eventos com IDs seguros e devolve o formato numérico do domínio", async () => {
  const event = await repository.create(draft);
  assert.equal(Number.isSafeInteger(event.id), true);
  assert.ok(event.id >= ID_NAMESPACE_START);
  assert.deepEqual({ ...event, id: 0 }, { ...draft, id: 0 });
});

test("lista todos os eventos e seleciona corretamente intervalos com virada de dia", async () => {
  const overnight = await repository.create({
    ...draft,
    title: "Virada",
    date: "2026-10-31",
    startTime: "23:30",
    endDate: "2026-11-01",
    endTime: "00:30",
  });
  await repository.create({ ...draft, title: "Dia seguinte", startTime: "00:00", endTime: "01:00" });
  await repository.create({ ...draft, title: "Dia anterior", date: "2026-10-30", endDate: "2026-10-30" });

  const allEvents = await repository.list();
  assert.equal(allEvents.length, 3);
  assert.deepEqual((await repository.list({ from: "2026-11-01", to: "2026-11-01" })).map(({ title }) => title), ["Virada", "Dia seguinte"]);
  assert.deepEqual((await repository.list({ from: "2026-10-31", to: "2026-10-31" })).map(({ title }) => title), ["Virada"]);
  assert.equal((await repository.getById(overnight.id))?.endDate, "2026-11-01");
});

test("limita resultados no Prisma sem afetar listagens sem limite", async () => {
  await repository.create({ ...draft, title: "Primeiro" });
  await repository.create({ ...draft, title: "Segundo", startTime: "11:00", endTime: "12:00" });
  await repository.create({ ...draft, title: "Terceiro", startTime: "13:00", endTime: "14:00" });
  assert.equal((await repository.list()).length, 3);
  assert.deepEqual((await repository.list({ from: draft.date, to: draft.date }, 2)).map(({ title }) => title), ["Primeiro", "Segundo"]);
  await assert.rejects(repository.list({}, 0), EventRepositoryValidationError);
  await assert.rejects(repository.list({}, 102), EventRepositoryValidationError);
});

test("rejeita intervalos inválidos e datas fora do formato antes de consultar o banco", async () => {
  await assert.rejects(repository.list({ from: "2026-11-02", to: "2026-11-01" }), EventRepositoryValidationError);
  await assert.rejects(repository.list({ from: "2026-02-30" }), EventRepositoryValidationError);
  await assert.rejects(repository.list(null), EventRepositoryValidationError);
});

test("consulta IDs históricos seguros sem arredondar BigInt", async () => {
  const oldId = 1_730_000_000_000;
  await client.event.create({ data: { id: BigInt(oldId), ...draft } });
  assert.deepEqual(await repository.getById(oldId), { id: oldId, ...draft });
  assert.equal(await repository.getById(9_999_999), null);
  await assert.rejects(repository.getById(Number.MAX_SAFE_INTEGER + 1), EventRepositoryValidationError);
});

test("atualiza campos sem permitir alterar o ID existente", async () => {
  const created = await repository.create(draft);
  const updated = await repository.update(created.id, { ...draft, title: "Título alterado" });
  assert.equal(updated?.id, created.id);
  assert.equal(updated?.title, "Título alterado");

  await assert.rejects(repository.update(created.id, { ...draft, id: created.id + 1 }), EventRepositoryValidationError);
  assert.deepEqual(await repository.getById(created.id), updated);
  assert.equal(await repository.update(9_999_999, draft), null);
});

test("rejeita dados inválidos e não grava eventos parcialmente", async () => {
  for (const invalid of [
    { ...draft, title: "   " },
    { ...draft, date: "2026-02-30" },
    { ...draft, endTime: "08:59" },
    { ...draft, category: "Outra" },
    { ...draft, id: 123 },
  ]) {
    await assert.rejects(repository.create(invalid), EventRepositoryValidationError);
  }
  assert.deepEqual(await repository.list(), []);
});

test("repete a alocação quando um ID candidato já pertence a um evento", async () => {
  const existingId = ID_NAMESPACE_START + 42;
  await client.event.create({ data: { id: BigInt(existingId), ...draft, title: "ID reservado" } });
  const candidates = [existingId, existingId + 1];
  const collisionSafeRepository = createEventRepository(client, { generateId: () => candidates.shift() });

  const created = await collisionSafeRepository.create(draft);
  assert.equal(created.id, existingId + 1);
  assert.equal((await repository.getById(existingId))?.title, "ID reservado");
});

test("retorna resultado explícito de exclusão e não falha ao excluir ID ausente", async () => {
  const created = await repository.create(draft);
  assert.equal(await repository.remove(created.id), true);
  assert.equal(await repository.remove(created.id), false);
  await assert.rejects(repository.remove(0.5), EventRepositoryValidationError);
});

test("os eventos permanecem após desconectar e reabrir a conexão ao arquivo temporário", async () => {
  const created = await repository.create(draft);
  await client.$disconnect();
  client = openTestClient(databasePath);
  repository = createEventRepository(client);

  assert.deepEqual(await repository.getById(created.id), created);
});

test("encerra a tentativa se o gerador produzir somente IDs repetidos", async () => {
  const duplicateId = ID_NAMESPACE_START + 99;
  await client.event.create({ data: { id: BigInt(duplicateId), ...draft } });
  const collisionSafeRepository = createEventRepository(client, { generateId: () => duplicateId });
  await assert.rejects(collisionSafeRepository.create(draft), EventIdAllocationError);
});

test("importa eventos válidos preservando IDs históricos, inclusive zero e negativos", async () => {
  const events = [
    { id: 1_730_000_000_000, title: "Histórico", ...draft },
    { id: 0, title: "ID zero", ...draft, date: "2026-11-02", endDate: "2026-11-02" },
    { id: -7, title: "ID negativo", ...draft, date: "2026-11-03", endDate: "2026-11-03" },
  ];
  const summary = await repository.importBatch(events);
  assert.deepEqual(summary, { received: 3, imported: 3, alreadyExisting: 0, conflicts: 0 });
  for (const event of events) assert.deepEqual(await repository.getById(event.id), event);
});

test("importa eventos que atravessam a meia-noite preservando data final e ID", async () => {
  const overnight = {
    id: 0,
    ...draft,
    date: "2026-10-31",
    startTime: "23:30",
    endDate: "2026-11-01",
    endTime: "00:30",
  };
  assert.deepEqual(await repository.importBatch([overnight]), {
    received: 1, imported: 1, alreadyExisting: 0, conflicts: 0,
  });
  assert.deepEqual(await repository.getById(0), overnight);
  assert.deepEqual((await repository.list({ from: "2026-11-01", to: "2026-11-01" })).map(({ id }) => id), [0]);
});

test("repetir a mesma importação é idempotente e não duplica registros", async () => {
  const events = [{ id: 12, ...draft }];
  assert.deepEqual(await repository.importBatch(events), {
    received: 1, imported: 1, alreadyExisting: 0, conflicts: 0,
  });
  assert.deepEqual(await repository.importBatch(events), {
    received: 1, imported: 0, alreadyExisting: 1, conflicts: 0,
  });
  assert.equal((await repository.list()).length, 1);
});

test("conflito de ID com conteúdo diferente não sobrescreve e informa conflito", async () => {
  const existing = { id: 24, ...draft, title: "Conteúdo no banco" };
  await client.event.create({ data: { ...existing, id: BigInt(existing.id) } });
  const summary = await repository.importBatch([{ ...existing, title: "Conteúdo do backup" }]);
  assert.deepEqual(summary, { received: 1, imported: 0, alreadyExisting: 0, conflicts: 1 });
  assert.deepEqual(await repository.getById(existing.id), existing);
});

test("conflitos abortam o lote sem alterar eventos existentes ou inserir novos", async () => {
  const conflicting = { id: 202, ...draft, title: "Versão existente" };
  await client.event.create({ data: { ...conflicting, id: BigInt(conflicting.id) } });
  const batch = [
    { id: 201, ...draft, title: "Seria inserido antes" },
    { ...conflicting, title: "Versão do backup" },
  ];

  assert.deepEqual(await repository.importBatch(batch), {
    received: 2, imported: 0, alreadyExisting: 0, conflicts: 1,
  });
  assert.equal(await repository.getById(201), null, "evento anterior ao conflito deve ter sido revertido");
  assert.deepEqual(await repository.getById(202), conflicting, "registro conflitante não deve ser alterado");
});

test("erro de escrita após a primeira inserção reverte a transação", async () => {
  const sqlite = new Database(databasePath);
  try {
    sqlite.exec(`CREATE TRIGGER reject_second_import BEFORE INSERT ON "Event"
      WHEN NEW.id = 402 BEGIN SELECT RAISE(ABORT, 'simulated database write failure'); END;`);
  } finally {
    sqlite.close();
  }

  await assert.rejects(repository.importBatch([
    { id: 401, ...draft, title: "Primeira inserção" },
    { id: 402, ...draft, title: "Falha simulada" },
  ]));
  assert.equal(await repository.getById(401), null, "a primeira inserção também deve ser revertida");
  assert.equal(await repository.getById(402), null);
});

test("valida o lote inteiro antes de gravar qualquer evento", async () => {
  const valid = { id: 301, ...draft };
  const invalid = { id: 302, ...draft, endTime: "08:00" };
  await assert.rejects(repository.importBatch([valid, invalid]));
  await assert.rejects(repository.importBatch([{ ...valid, extraPersonalData: "not supported" }]));
  assert.deepEqual(await repository.list(), []);
});

test("aceita eventos de backup JSON v1 sem mudar o formato nem os IDs", async () => {
  const events = [{
    id: 1_730_000_000_001,
    title: "Plantão",
    date: "2026-10-31",
    endDate: "2026-11-01",
    startTime: "23:59",
    endTime: "00:59",
    category: "Saúde",
  }];
  const backupJson = createEventBackup(events, new Date("2026-10-31T12:00:00.000Z"));
  const parsedBackup = parseEventBackup(backupJson);
  assert.equal(parsedBackup.version, 1);
  assert.deepEqual(await repository.importBatch(parsedBackup.events), {
    received: 1, imported: 1, alreadyExisting: 0, conflicts: 0,
  });
  assert.deepEqual(await repository.getById(events[0].id), events[0]);
});

test("suíte de importação usa exclusivamente banco temporário", async () => {
  assert.equal(databasePath.startsWith(temporaryDirectory), true);
  assert.notEqual(databasePath, join(process.cwd(), "prisma", "mortus.db"));
});
