import test from "node:test";
import assert from "node:assert/strict";
import { requestAssistant } from "../app/lib/assistantClient.ts";

const sampleEvent = {
  id: 3,
  title: "Revisão do projeto",
  date: "2026-11-06",
  endDate: "2026-11-06",
  startTime: "14:00",
  endTime: "15:00",
  category: "Trabalho",
};

test("cliente chama somente POST /api/assistant com a mensagem e formata eventos", async () => {
  let request;
  const reply = await requestAssistant("O que tenho amanhã?", async (url, options) => {
    request = { url, options };
    return Response.json({ data: {
      provider: "gemini",
      intent: "calendar_events",
      message: "Encontrei 1 evento.",
      data: { from: "2026-11-06", to: "2026-11-06", events: [sampleEvent], truncated: false },
    } });
  });

  assert.equal(request.url, "/api/assistant");
  assert.equal(request.options.method, "POST");
  assert.deepEqual(JSON.parse(request.options.body), { message: "O que tenho amanhã?" });
  assert.equal(reply.message, "Encontrei 1 evento.");
  assert.equal(reply.presentation.kind, "events");
  assert.deepEqual(reply.presentation.events, [sampleEvent]);
});

test("cliente apresenta resumo e lista vazia sem expor JSON bruto", async () => {
  const reply = await requestAssistant("Quantos compromissos tenho?", async () => Response.json({ data: {
    intent: "agenda_summary",
    message: "Sua agenda está livre.",
    data: { from: "2026-11-06", to: "2026-11-12", eventCount: 0, byDate: [], byCategory: [] },
  } }));

  assert.equal(reply.message, "Sua agenda está livre.");
  assert.deepEqual(reply.presentation, {
    kind: "summary",
    from: "2026-11-06",
    to: "2026-11-12",
    eventCount: 0,
    byDate: [],
    byCategory: [],
  });
});

test("cliente mostra mensagens seguras para HTTP e respostas inesperadas", async () => {
  await assert.rejects(
    requestAssistant("Oi", async () => Response.json({ error: { code: "PROVIDER_UNAVAILABLE", message: "internal detail" } }, { status: 503 })),
    (error) => error.message.includes("indisponível") && !error.message.includes("internal detail"),
  );
  await assert.rejects(
    requestAssistant("Oi", async () => Response.json({ nope: true })),
    /resposta inesperada/,
  );
  await assert.rejects(
    requestAssistant("Oi", async () => { throw Object.assign(new Error("private request data"), { cause: new Error("private cause") }); }),
    (error) => error.message.includes("conectar") && !error.message.includes("private"),
  );
});
