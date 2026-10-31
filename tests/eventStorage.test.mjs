import test from "node:test";
import assert from "node:assert/strict";
import { EVENT_STORAGE_KEY } from "../app/lib/events.ts";
import { loadCalendarEvents, saveCalendarEvents } from "../app/lib/eventStorage.ts";

const event = { id: 1, title: "Planejamento", date: "2026-11-05", endDate: "2026-11-05", startTime: "10:00", endTime: "11:00", category: "Trabalho" };

function mockStorage(initialValue = null) {
  const values = new Map(initialValue === null ? [] : [[EVENT_STORAGE_KEY, initialValue]]);
  const calls = { reads: [], writes: [] };
  return {
    values,
    calls,
    getItem(key) { calls.reads.push(key); return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { calls.writes.push([key, value]); values.set(key, value); },
  };
}

function captureExpectedError(callback) {
  const originalError = console.error;
  let calls = 0;
  console.error = () => { calls += 1; };
  try {
    return { result: callback(), calls };
  } finally {
    console.error = originalError;
  }
}

test("classifica armazenamento vazio e retorna os dados iniciais sem gravar", () => {
  const storage = mockStorage();
  const result = loadCalendarEvents(() => storage, [event]);
  assert.equal(result.status, "empty");
  assert.equal(result.canWrite, true);
  assert.deepEqual(result.events, [event]);
  assert.deepEqual(storage.calls.writes, []);
});

test("lê eventos válidos usando a chave estável", () => {
  const storage = mockStorage(JSON.stringify([event]));
  const result = loadCalendarEvents(() => storage, []);
  assert.equal(result.status, "valid");
  assert.deepEqual(result.events, [event]);
  assert.deepEqual(storage.calls.reads, ["mortus.calendar.events.v1"]);
  assert.equal(EVENT_STORAGE_KEY, "mortus.calendar.events.v1");
});

test("JSON corrompido é inválido, preservado e bloqueia gravações", () => {
  const storage = mockStorage("{quebrado");
  const result = loadCalendarEvents(() => storage, [event]);
  assert.equal(result.status, "invalid");
  assert.equal(result.canWrite, false);
  assert.equal(storage.values.get(EVENT_STORAGE_KEY), "{quebrado");
  assert.match(result.warning, /JSON válido/);
});

test("eventos inválidos não são substituídos por dados de demonstração", () => {
  const original = JSON.stringify([{ ...event, endTime: "09:00" }]);
  const storage = mockStorage(original);
  const result = loadCalendarEvents(() => storage, [event]);
  assert.equal(result.status, "invalid");
  assert.deepEqual(result.events, []);
  assert.equal(storage.values.get(EVENT_STORAGE_KEY), original);
});

test("falha simulada de leitura é indisponível e não tenta gravar", () => {
  const storage = { getItem() { throw new Error("read denied"); }, setItem() { assert.fail("não deveria gravar"); } };
  const { result, calls } = captureExpectedError(() => loadCalendarEvents(() => storage, [event]));
  assert.equal(calls, 1);
  assert.equal(result.status, "unavailable");
  assert.equal(result.canWrite, false);
  assert.deepEqual(result.events, []);
});

test("falha simulada de gravação retorna false", () => {
  const storage = { setItem() { throw new Error("quota exceeded"); } };
  const { result, calls } = captureExpectedError(() => saveCalendarEvents(() => storage, [event]));
  assert.equal(result, false);
  assert.equal(calls, 1);
});

test("persiste a migração legada na mesma chave", () => {
  const storage = mockStorage(JSON.stringify([{ id: 2, title: "Legado", date: event.date, time: "13:00", category: "Pessoal" }]));
  const result = loadCalendarEvents(() => storage, []);
  assert.equal(result.status, "valid");
  assert.equal(result.events[0].endTime, "14:00");
  assert.equal(storage.calls.writes[0][0], "mortus.calendar.events.v1");
  assert.equal(JSON.parse(storage.values.get(EVENT_STORAGE_KEY))[0].startTime, "13:00");
});

test("falha ao persistir migração mantém o conteúdo antigo e bloqueia novas gravações", () => {
  const original = JSON.stringify([{ id: 3, title: "Legado", date: event.date, time: "23:30", category: "Pessoal" }]);
  const storage = { getItem: () => original, setItem() { throw new Error("quota exceeded"); } };
  const { result, calls } = captureExpectedError(() => loadCalendarEvents(() => storage, []));
  assert.equal(result.status, "valid");
  assert.equal(result.canWrite, false);
  assert.equal(calls, 1);
  assert.equal(storage.getItem(EVENT_STORAGE_KEY), original);
  assert.equal(result.events[0].startTime, "23:30");
  assert.equal(result.events[0].endTime, "00:30");
  assert.equal(result.events[0].endDate, "2026-11-06");
  assert.match(result.warning, /migração não pôde ser gravada/);
});

test("salvamento grava JSON válido pela chave estável", () => {
  const storage = mockStorage();
  assert.equal(saveCalendarEvents(() => storage, [event]), true);
  assert.deepEqual(storage.calls.writes, [["mortus.calendar.events.v1", JSON.stringify([event])]]);
});
