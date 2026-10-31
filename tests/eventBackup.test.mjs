import test from "node:test";
import assert from "node:assert/strict";
import { createEventBackup, EVENT_BACKUP_VERSION, parseEventBackup } from "../app/lib/eventBackup.ts";

const events = [
  { id: 1, title: "Revisão", date: "2026-11-06", endDate: "2026-11-06", startTime: "09:00", endTime: "10:00", category: "Trabalho" },
  { id: 2, title: "Almoço", date: "2026-11-06", endDate: "2026-11-06", startTime: "12:00", endTime: "13:00", category: "Pessoal" },
];
const exportDate = new Date("2026-11-01T12:34:56.000Z");

test("exporta backup JSON válido com versão, data e eventos íntegros", () => {
  const contents = createEventBackup(events, exportDate);
  const backup = JSON.parse(contents);
  assert.equal(backup.version, EVENT_BACKUP_VERSION);
  assert.equal(backup.exportedAt, "2026-11-01T12:34:56.000Z");
  assert.deepEqual(backup.events, events);
});

test("importa backup válido sem alterar o conteúdo dos eventos", () => {
  const backup = parseEventBackup(createEventBackup(events, exportDate));
  assert.deepEqual(backup.events, events);
  assert.equal(backup.exportedAt, exportDate.toISOString());
});

test("rejeita JSON inválido", () => {
  assert.throws(() => parseEventBackup("{json inválido"), /JSON válido/);
});

test("rejeita estrutura incompatível e versão desconhecida", () => {
  assert.throws(() => parseEventBackup(JSON.stringify({ items: events })), /Formato de backup incompatível/);
  assert.throws(() => parseEventBackup(JSON.stringify({ version: 99, exportedAt: exportDate.toISOString(), events })), /Formato de backup incompatível/);
});

test("rejeita data de exportação inválida ou fora do formato ISO", () => {
  assert.throws(() => parseEventBackup(JSON.stringify({ version: 1, exportedAt: "data inválida", events })), /Formato de backup incompatível/);
  assert.throws(() => parseEventBackup(JSON.stringify({ version: 1, exportedAt: "2026-11-01", events })), /Formato de backup incompatível/);
});

test("rejeita backup com evento ou horário inválido por inteiro", () => {
  const invalidEvents = [{ ...events[0], endTime: "08:00" }, events[1]];
  assert.throws(() => parseEventBackup(JSON.stringify({ version: 1, exportedAt: exportDate.toISOString(), events: invalidEvents })), /eventos inválidos/);
});

test("rejeita backup com IDs repetidos", () => {
  const duplicates = [events[0], { ...events[1], id: events[0].id }];
  assert.throws(() => parseEventBackup(JSON.stringify({ version: 1, exportedAt: exportDate.toISOString(), events: duplicates })), /eventos inválidos/);
});

test("exportação rejeita eventos inválidos sem modificar a lista de origem", () => {
  const invalid = [{ ...events[0], startTime: "25:00" }];
  const snapshot = structuredClone(invalid);
  assert.throws(() => createEventBackup(invalid, exportDate), /eventos inválidos/);
  assert.deepEqual(invalid, snapshot);
});

test("rejeita arquivos acima do limite definido", () => {
  assert.throws(() => parseEventBackup(" ".repeat(5 * 1024 * 1024 + 1)), /5 MB/);
});
