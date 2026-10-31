import test from "node:test";
import assert from "node:assert/strict";
import {
  containsEvents,
  createSqliteEvent,
  deleteSqliteEvent,
  EventApiClientError,
  fetchSqliteEvents,
  updateSqliteEvent,
} from "../app/lib/eventApiClient.ts";

const event = {
  id: 1_730_000_000_000,
  title: "Plantão",
  date: "2026-10-31",
  endDate: "2026-11-01",
  startTime: "23:30",
  endTime: "00:30",
  category: "Trabalho",
};
const draft = Object.fromEntries(Object.entries(event).filter(([key]) => key !== "id"));

function withFetch(implementation, body) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = implementation;
  return Promise.resolve().then(body).finally(() => { globalThis.fetch = originalFetch; });
}

test("cliente lê lista válida do SQLite sem transformar falha em lista vazia", async () => {
  await withFetch(async () => Response.json([event]), async () => {
    assert.deepEqual(await fetchSqliteEvents(), [event]);
  });
  await withFetch(async () => { throw new TypeError("offline"); }, async () => {
    await assert.rejects(fetchSqliteEvents(), EventApiClientError);
  });
  await withFetch(async () => Response.json({ error: "temporário" }, { status: 500 }), async () => {
    await assert.rejects(fetchSqliteEvents(), /temporário/);
  });
});

test("cliente valida resposta do servidor para lista e evento", async () => {
  await withFetch(async () => Response.json([]), async () => {
    assert.deepEqual(await fetchSqliteEvents(), []);
  });
  await withFetch(async () => Response.json([{ ...event, id: Number.MAX_SAFE_INTEGER + 1 }]), async () => {
    await assert.rejects(fetchSqliteEvents(), EventApiClientError);
  });
  await withFetch(async () => Response.json({ ...event, category: "inválida" }), async () => {
    await assert.rejects(createSqliteEvent(draft), EventApiClientError);
  });
});

test("cliente usa POST, PATCH e DELETE e retorna dados compatíveis", async () => {
  const calls = [];
  await withFetch(async (url, options) => {
    calls.push({ url, method: options?.method ?? "GET" });
    return options?.method === "DELETE" ? new Response(null, { status: 204 }) : Response.json(event);
  }, async () => {
    assert.deepEqual(await createSqliteEvent(draft), event);
    assert.deepEqual(await updateSqliteEvent(event.id, draft), event);
    await deleteSqliteEvent(event.id);
  });
  assert.deepEqual(calls.map(({ method }) => method), ["POST", "PATCH", "DELETE"]);
  assert.equal(calls[1].url, `/api/events/${event.id}`);
});

test("conferência pós-migração exige correspondência exata de ID e campos", () => {
  assert.equal(containsEvents([event], [event]), true);
  assert.equal(containsEvents([{ ...event, title: "outro" }], [event]), false);
  assert.equal(containsEvents([], [event]), false);
  assert.equal(containsEvents([event], []), true);
});
