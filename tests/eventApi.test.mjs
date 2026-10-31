import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../app/generated/prisma/client.ts";
import { createEventApi } from "../app/lib/eventApi.ts";
import { createEventRepository, EventIdAllocationError } from "../app/lib/eventRepository.ts";

const migrationSql = readFileSync(new URL("../prisma/migrations/20261031211833_init/migration.sql", import.meta.url), "utf8");
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
let api;

function openTestClient(path) {
  return new PrismaClient({
    adapter: new PrismaBetterSqlite3({ url: `file:${path.replaceAll("\\", "/")}` }),
  });
}

function request(path, { method = "GET", body, origin = "http://127.0.0.1:3000", host = "127.0.0.1:3000" } = {}) {
  const headers = new Headers({ host });
  if (origin !== null) headers.set("origin", origin);
  if (body !== undefined) headers.set("content-type", "application/json");
  return new Request(`http://${host}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
}

async function eventId(response) {
  return (await response.json()).id;
}

beforeEach(() => {
  temporaryDirectory = mkdtempSync(join(tmpdir(), "mortus-api-test-"));
  databasePath = join(temporaryDirectory, "isolated.db");
  const sqlite = new Database(databasePath);
  try {
    sqlite.exec(migrationSql);
  } finally {
    sqlite.close();
  }
  client = openTestClient(databasePath);
  repository = createEventRepository(client);
  api = createEventApi(repository);
});

afterEach(async () => {
  if (client) await client.$disconnect();
  if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true });
});

test("POST cria e GET lista evento com JSON compatível e ID numérico", async () => {
  const created = await api.create(request("/api/events", { method: "POST", body: draft }));
  assert.equal(created.status, 201);
  const saved = await created.json();
  assert.equal(typeof saved.id, "number");
  assert.deepEqual({ ...saved, id: 0 }, { ...draft, id: 0 });

  const listed = await api.list(request("/api/events"));
  assert.equal(listed.status, 200);
  assert.deepEqual(await listed.json(), [saved]);
});

test("GET aplica filtros opcionais e inclui eventos que atravessam a meia-noite", async () => {
  const overnight = {
    ...draft,
    title: "Virada",
    date: "2026-10-31",
    startTime: "23:30",
    endDate: "2026-11-01",
    endTime: "00:30",
  };
  await api.create(request("/api/events", { method: "POST", body: overnight }));
  await api.create(request("/api/events", { method: "POST", body: { ...draft, title: "Manhã" } }));

  const response = await api.list(request("/api/events?from=2026-11-01&to=2026-11-01"));
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).map(({ title }) => title), ["Virada", "Manhã"]);
});

test("GET rejeita datas, intervalos e filtros malformados", async () => {
  assert.equal((await api.list(request("/api/events?from=2026-02-30"))).status, 400);
  assert.equal((await api.list(request("/api/events?from=2026-11-02&to=2026-11-01"))).status, 400);
  assert.equal((await api.list(request("/api/events?other=x"))).status, 400);
  assert.equal((await api.list(request("/api/events?from=2026-11-01&from=2026-11-02"))).status, 400);
});

test("GET por ID consulta existente, retorna 404 para ausente e 400 para malformado", async () => {
  const created = await api.create(request("/api/events", { method: "POST", body: draft }));
  const id = await eventId(created);
  const fetched = await api.get(request(`/api/events/${id}`), { params: Promise.resolve({ id: String(id) }) });
  assert.deepEqual(await fetched.json(), { ...draft, id });
  assert.equal((await api.get(request("/api/events/123"), { params: Promise.resolve({ id: "123" }) })).status, 404);
  for (const malformed of ["-", "1.5", "abc", "9007199254740992"]) {
    assert.equal((await api.get(request(`/api/events/${malformed}`), { params: Promise.resolve({ id: malformed }) })).status, 400);
  }
});

test("PATCH edita evento sem aceitar alteração do ID", async () => {
  const created = await api.create(request("/api/events", { method: "POST", body: draft }));
  const id = await eventId(created);
  const updated = await api.update(request(`/api/events/${id}`, {
    method: "PATCH",
    body: { title: "Novo título", endTime: "11:00" },
  }), { params: Promise.resolve({ id: String(id) }) });
  assert.equal(updated.status, 200);
  assert.deepEqual(await updated.json(), { ...draft, id, title: "Novo título", endTime: "11:00" });
  assert.equal((await api.update(request(`/api/events/${id}`, {
    method: "PATCH", body: { id: id + 1 },
  }), { params: Promise.resolve({ id: String(id) }) })).status, 400);
});

test("PATCH rejeita campos inválidos e retorna 404 para evento inexistente", async () => {
  const created = await api.create(request("/api/events", { method: "POST", body: draft }));
  const id = await eventId(created);
  for (const invalid of [{ title: " " }, { date: "2026-02-30" }, { endTime: "08:00" }, { category: "Outra" }, { extra: true }]) {
    assert.equal((await api.update(request(`/api/events/${id}`, { method: "PATCH", body: invalid }), { params: Promise.resolve({ id: String(id) }) })).status, 400);
  }
  assert.equal((await api.update(request("/api/events/777", { method: "PATCH", body: { title: "ausente" } }), { params: Promise.resolve({ id: "777" }) })).status, 404);
});

test("DELETE remove evento, retorna 204 e informa evento inexistente", async () => {
  const created = await api.create(request("/api/events", { method: "POST", body: draft }));
  const id = await eventId(created);
  assert.equal((await api.remove(request(`/api/events/${id}`, { method: "DELETE" }), { params: Promise.resolve({ id: String(id) }) })).status, 204);
  assert.equal((await api.remove(request(`/api/events/${id}`, { method: "DELETE" }), { params: Promise.resolve({ id: String(id) }) })).status, 404);
});

test("POST rejeita JSON inválido, corpo que não é objeto e campos de evento inválidos", async () => {
  assert.equal((await api.create(request("/api/events", { method: "POST", body: "{" }))).status, 400);
  assert.equal((await api.create(request("/api/events", { method: "POST", body: [] }))).status, 400);
  for (const invalid of [{ ...draft, title: " " }, { ...draft, date: "2026-02-30" }, { ...draft, endDate: "2026-10-31" }, { ...draft, category: "Outra" }, { ...draft, id: 123 }]) {
    assert.equal((await api.create(request("/api/events", { method: "POST", body: invalid }))).status, 400);
  }
});

test("escritas exigem Origin local permitido e Host correspondente", async () => {
  assert.equal((await api.create(request("/api/events", { method: "POST", body: draft, origin: null }))).status, 403);
  assert.equal((await api.create(request("/api/events", { method: "POST", body: draft, origin: "https://evil.example" }))).status, 403);
  assert.equal((await api.create(request("/api/events", { method: "POST", body: draft, host: "evil.example" }))).status, 403);
  assert.equal((await api.create(request("/api/events", { method: "POST", body: draft, host: "localhost:3000" }))).status, 403);
  assert.equal((await api.list(request("/api/events", { origin: "https://evil.example" }))).status, 403);
  assert.equal((await api.list(request("/api/events", { host: "attacker.example" }))).status, 403);
});

test("não expõe mensagens internas quando o repositório falha", async () => {
  const brokenApi = createEventApi({
    create: async () => { throw new Error("DATABASE_PASSWORD=private-value"); },
    list: async () => [],
    getById: async () => null,
    update: async () => null,
    remove: async () => false,
  });
  const response = await brokenApi.create(request("/api/events", { method: "POST", body: draft }));
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "Erro interno ao processar o evento." });
});

test("responde 409 se a faixa de IDs não puder alocar ID sem colisão", async () => {
  const exhaustedApi = createEventApi({
    create: async () => { throw new EventIdAllocationError(); },
    list: async () => [],
    getById: async () => null,
    update: async () => null,
    remove: async () => false,
  });
  assert.equal((await exhaustedApi.create(request("/api/events", { method: "POST", body: draft }))).status, 409);
});

test("evento criado pela API persiste após reconectar ao SQLite temporário", async () => {
  const response = await api.create(request("/api/events", { method: "POST", body: draft }));
  const saved = await response.json();
  await client.$disconnect();
  client = openTestClient(databasePath);
  api = createEventApi(createEventRepository(client));

  const reloaded = await api.get(request(`/api/events/${saved.id}`), { params: Promise.resolve({ id: String(saved.id) }) });
  assert.deepEqual(await reloaded.json(), saved);
});
