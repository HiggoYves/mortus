import test from "node:test";
import assert from "node:assert/strict";
import {
  createCalendarEvent,
  deleteCalendarEvent,
  findEventConflicts,
  migrateCalendarEventList,
  updateCalendarEvent,
  validateEventTimeRange,
} from "../app/lib/events.ts";

const first = { id: 1, title: "Consulta", date: "2026-11-02", endDate: "2026-11-02", startTime: "09:00", endTime: "10:00", category: "Pessoal" };
const second = { id: 2, title: "Reunião", date: "2026-11-02", endDate: "2026-11-02", startTime: "11:00", endTime: "12:00", category: "Trabalho" };
const draft = { title: "Almoço", date: "2026-11-02", endDate: "2026-11-02", startTime: "12:00", endTime: "13:00", category: "Pessoal" };

test("cria evento válido sem remover os eventos existentes", () => {
  const result = createCalendarEvent([first], draft, 3);
  assert.deepEqual(result, [first, { ...draft, id: 3 }]);
});

test("rejeita campos obrigatórios inválidos e mantém a lista original", () => {
  for (const invalidDraft of [
    { ...draft, title: "   " },
    { ...draft, date: "2026-02-30" },
    { ...draft, category: "Outra" },
    { ...draft, startTime: "" },
  ]) {
    assert.deepEqual(createCalendarEvent([first], invalidDraft, 3), [first]);
  }
});

test("rejeita IDs duplicados ao criar", () => {
  assert.deepEqual(createCalendarEvent([first], draft, first.id), [first]);
});

test("edita somente o evento solicitado e preserva os demais", () => {
  const result = updateCalendarEvent([first, second], first.id, { ...draft, title: "Consulta alterada" });
  assert.deepEqual(result, [{ ...draft, id: first.id, title: "Consulta alterada" }, second]);
});

test("edição inválida ou de ID inexistente preserva todos os eventos", () => {
  assert.deepEqual(updateCalendarEvent([first, second], first.id, { ...draft, endTime: "08:00" }), [first, second]);
  assert.deepEqual(updateCalendarEvent([first, second], 99, draft), [first, second]);
});

test("exclui somente o evento identificado", () => {
  assert.deepEqual(deleteCalendarEvent([first, second], first.id), [second]);
  assert.deepEqual(deleteCalendarEvent([first, second], 99), [first, second]);
});

test("rejeita término igual ao início e anterior ao início", () => {
  assert.notEqual(validateEventTimeRange("2026-11-02", "09:00", "2026-11-02", "09:00"), null);
  assert.notEqual(validateEventTimeRange("2026-11-02", "09:00", "2026-11-02", "08:59"), null);
});

test("aceita evento no dia seguinte e detecta conflito entre datas", () => {
  const overnight = { ...first, date: "2026-10-31", startTime: "23:30", endDate: "2026-11-01", endTime: "00:30" };
  const nextDay = { ...second, date: "2026-11-01", endDate: "2026-11-01", startTime: "00:00", endTime: "01:00" };
  assert.equal(validateEventTimeRange(overnight.date, overnight.startTime, overnight.endDate, overnight.endTime), null);
  assert.equal(findEventConflicts([overnight, nextDay]).length, 1);
  assert.deepEqual(findEventConflicts([overnight, { ...nextDay, startTime: "00:30", endTime: "01:00" }]), []);
});

test("detecta sobreposição parcial e contenção de horários", () => {
  const overlap = { ...second, startTime: "09:30", endTime: "10:30" };
  const contains = { ...second, startTime: "08:30", endTime: "10:30" };
  assert.equal(findEventConflicts([first, overlap]).length, 1);
  assert.equal(findEventConflicts([first, contains]).length, 1);
});

test("eventos consecutivos e em datas diferentes não conflitam", () => {
  const consecutive = { ...second, startTime: "10:00", endTime: "11:00" };
  const otherDate = { ...second, date: "2026-11-03", startTime: "09:30", endTime: "10:30" };
  assert.deepEqual(findEventConflicts([first, consecutive]), []);
  assert.deepEqual(findEventConflicts([first, otherDate]), []);
});

test("editar evento mantém uma única ocorrência e não conflita consigo mesmo", () => {
  const edited = updateCalendarEvent([first, second], first.id, { ...draft, title: "Consulta alterada", startTime: "09:00", endTime: "10:00" });
  assert.equal(edited.filter((event) => event.id === first.id).length, 1);
  assert.deepEqual(findEventConflicts(edited), []);
});

test("migra eventos antigos e preserva ID, título, data e categoria", () => {
  const migrated = migrateCalendarEventList([{ id: 7, title: "Antigo", date: "2026-11-04", time: "14:15", category: "Saúde" }]);
  assert.deepEqual(migrated, [{ id: 7, title: "Antigo", date: "2026-11-04", endDate: "2026-11-04", startTime: "14:15", endTime: "15:15", category: "Saúde" }]);
});

test("mantém eventos já migrados compatíveis", () => {
  assert.deepEqual(migrateCalendarEventList([first]), [first]);
});

test("rejeita lista ou registros migrados inválidos sem conversão parcial", () => {
  assert.equal(migrateCalendarEventList({ events: [first] }), null);
  const invalidLegacy = { id: second.id, title: second.title, date: second.date, time: "inválido", category: second.category };
  assert.equal(migrateCalendarEventList([first, invalidLegacy]), null);
});

test("migra horário inicial próximo à meia-noite com duração de uma hora", () => {
  const migrated = migrateCalendarEventList([{ id: 8, title: "Fim do dia", date: "2026-11-04", time: "23:30", category: "Pessoal" }]);
  assert.equal(migrated?.[0].endTime, "00:30");
  assert.equal(migrated?.[0].endDate, "2026-11-05");
});

test("migra às 23:59 para o dia seguinte", () => {
  const migrated = migrateCalendarEventList([{ id: 9, title: "Meia-noite", date: "2026-11-04", time: "23:59", category: "Pessoal" }]);
  assert.equal(migrated?.[0].endDate, "2026-11-05");
  assert.equal(migrated?.[0].endTime, "00:59");
});

test("mantém horários já migrados e acrescenta data de término", () => {
  const migrated = migrateCalendarEventList([{ id: 10, title: "Migrado", date: "2026-11-04", startTime: "23:30", endTime: "23:59", category: "Pessoal" }]);
  assert.equal(migrated?.[0].endTime, "23:59");
  assert.equal(migrated?.[0].endDate, "2026-11-04");
});

test("migra evento antigo com término antes do início para o dia seguinte", () => {
  const migrated = migrateCalendarEventList([{ id: 11, title: "Virada", date: "2026-11-04", startTime: "23:30", endTime: "00:30", category: "Pessoal" }]);
  assert.equal(migrated?.[0].startTime, "23:30");
  assert.equal(migrated?.[0].endTime, "00:30");
  assert.equal(migrated?.[0].endDate, "2026-11-05");
});
