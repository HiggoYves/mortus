import test from "node:test";
import assert from "node:assert/strict";
import { assistantHttpErrorMessage, formatAssistantDate, parseAssistantPresentation } from "../app/lib/assistantPresentation.ts";

const event = {
  id: 17,
  title: "Reunião de planejamento",
  date: "2026-11-06",
  endDate: "2026-11-06",
  startTime: "09:30",
  endTime: "10:30",
  category: "Trabalho",
};

test("prepara eventos válidos para apresentação legível e mantém indicação de truncamento", () => {
  assert.deepEqual(parseAssistantPresentation("calendar_events", {
    from: "2026-11-06",
    to: "2026-11-07",
    events: [event],
    truncated: true,
  }), {
    kind: "events",
    from: "2026-11-06",
    to: "2026-11-07",
    events: [event],
    truncated: true,
  });
  assert.match(formatAssistantDate("2026-11-06"), /6 de novembro de 2026/);
});

test("apresenta listas e resumos vazios como resultados válidos", () => {
  assert.deepEqual(parseAssistantPresentation("calendar_events", {
    from: "2026-11-06",
    to: "2026-11-06",
    events: [],
    truncated: false,
  })?.kind, "events");
  assert.deepEqual(parseAssistantPresentation("agenda_summary", {
    from: "2026-11-06",
    to: "2026-11-12",
    eventCount: 0,
    byDate: [],
    byCategory: [],
  }), {
    kind: "summary",
    from: "2026-11-06",
    to: "2026-11-12",
    eventCount: 0,
    byDate: [],
    byCategory: [],
  });
});

test("não tenta renderizar dados malformados ou eventos inválidos", () => {
  assert.equal(parseAssistantPresentation("calendar_events", {
    from: "2026-11-06",
    to: "2026-11-07",
    events: [{ ...event, startTime: "25:99" }],
    truncated: false,
  }), null);
  assert.equal(parseAssistantPresentation("agenda_summary", {
    from: "2026-11-06",
    to: "2026-11-07",
    eventCount: -1,
    byDate: [],
    byCategory: [],
  }), null);
  assert.equal(parseAssistantPresentation("calendar_events", {
    from: "2026-11-08",
    to: "2026-11-07",
    events: [],
    truncated: false,
  }), null);
  assert.equal(parseAssistantPresentation("unknown", { events: [event] }), null);
});

test("mapeia erros HTTP para mensagens seguras e acionáveis", () => {
  assert.match(assistantHttpErrorMessage(429, "USAGE_LIMIT_EXCEEDED"), /limite de consultas/i);
  assert.match(assistantHttpErrorMessage(503, "PROVIDER_UNAVAILABLE"), /indisponível/i);
  assert.match(assistantHttpErrorMessage(503, "CALENDAR_UNAVAILABLE"), /agenda/i);
  assert.doesNotMatch(assistantHttpErrorMessage(500, null), /SQL|SQLite|secret|API key/i);
});
