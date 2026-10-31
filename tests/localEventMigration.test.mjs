import test from "node:test";
import assert from "node:assert/strict";
import { demoEvents, separateDemoEvents } from "../app/lib/demoEvents.ts";
import { parseLocalMigrationSource } from "../app/lib/localEventMigration.ts";

const personal = {
  id: 1_730_000_000_000,
  title: "Plantão noturno",
  date: "2026-10-31",
  endDate: "2026-11-01",
  startTime: "23:30",
  endTime: "00:30",
  category: "Trabalho",
};

test("armazenamento local vazio não converte os eventos de demonstração em dados para migrar", () => {
  assert.deepEqual(parseLocalMigrationSource(null), {
    sourceEvents: [], eventsToMigrate: [], demoCount: demoEvents.length,
  });
});

test("JSON local inválido e listas incompatíveis bloqueiam a preparação", () => {
  assert.equal(parseLocalMigrationSource("{"), null);
  assert.equal(parseLocalMigrationSource(JSON.stringify([{ ...personal, endTime: "24:00" }])), null);
});

test("separa demonstrações exatas de eventos reais e preserva a fonte integral", () => {
  const source = [...demoEvents, personal];
  const parsed = parseLocalMigrationSource(JSON.stringify(source));
  assert.deepEqual(parsed?.sourceEvents, source);
  assert.deepEqual(parsed?.eventsToMigrate, [personal]);
  assert.equal(parsed?.demoCount, demoEvents.length);
});

test("evento editado a partir de uma demonstração é tratado como dado real", () => {
  const editedDemo = { ...demoEvents[0], title: "Revisão real do projeto" };
  const split = separateDemoEvents([editedDemo]);
  assert.deepEqual(split, { events: [editedDemo], demoCount: 0 });
});

test("eventos legados são normalizados para o formato atual sem modificar o JSON de origem", () => {
  const legacy = [{ id: 88, title: "Evento antigo", date: "2026-10-31", time: "23:30", category: "Pessoal" }];
  const sourceText = JSON.stringify(legacy);
  const parsed = parseLocalMigrationSource(sourceText);
  assert.equal(JSON.stringify(legacy), sourceText);
  assert.deepEqual(parsed?.eventsToMigrate[0], {
    id: 88,
    title: "Evento antigo",
    date: "2026-10-31",
    endDate: "2026-11-01",
    startTime: "23:30",
    endTime: "00:30",
    category: "Pessoal",
  });
});
