import test from "node:test";
import assert from "node:assert/strict";
import { createAssistantApi, MAX_ASSISTANT_BODY_BYTES } from "../app/lib/ai/assistantApi.ts";
import { createAssistantService } from "../app/lib/ai/assistantService.ts";
import { executeCalendarReadTool, MAX_CALENDAR_TOOL_EVENTS, MAX_CALENDAR_TOOL_RANGE_DAYS } from "../app/lib/ai/calendarTools.ts";
import { mockAssistantProvider } from "../app/lib/ai/mockProvider.ts";
import { assistantReadOnlyTools, AssistantError } from "../app/lib/ai/types.ts";
import { createGeminiProviderCore, DEFAULT_GEMINI_MODEL, GEMINI_MAX_OUTPUT_TOKENS, GEMINI_TIME_ZONE } from "../app/lib/ai/geminiProviderCore.ts";
import { GeminiUsageLimiter, GEMINI_MAX_REQUESTS_PER_DAY, GEMINI_MAX_REQUESTS_PER_MINUTE } from "../app/lib/ai/usageLimits.ts";
import { selectAssistantProvider } from "../app/lib/ai/providerSelection.ts";

function request(body, { origin = "http://127.0.0.1:3000", host = "127.0.0.1:3000" } = {}) {
  const headers = new Headers({ host, "content-type": "application/json" });
  if (origin !== null) headers.set("origin", origin);
  return new Request(`http://${host}/api/assistant`, {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

test("provedor simulado responde deterministicamente sem consultar ou receber eventos", async () => {
  const service = createAssistantService(mockAssistantProvider);
  assert.deepEqual(await service.respond("Oi!"), {
    intent: "greeting",
    message: "Olá! Sou o assistente de teste do Mortus. Ainda não consulto sua agenda.",
    provider: "mock",
  });
  assert.equal((await service.respond("Quero ver minha agenda")).intent, "calendar_help");
  assert.equal((await service.respond("Conte uma curiosidade")).intent, "unknown");
  assert.deepEqual(assistantReadOnlyTools.map(({ name }) => name), ["list_events", "get_agenda_summary"]);
  assert.equal(assistantReadOnlyTools.some(({ name }) => /create|update|delete|sql/i.test(name)), false);
});

test("serviço valida entrada e limite de caracteres antes de chamar o provedor", async () => {
  let calls = 0;
  const service = createAssistantService({ name: "counting", async respond() { calls += 1; throw new Error("unexpected"); } }, { maxMessageLength: 5 });
  await assert.rejects(service.respond("  "), { code: "INVALID_MESSAGE" });
  await assert.rejects(service.respond("123456"), { code: "MESSAGE_TOO_LONG" });
  assert.equal(calls, 0);
});

test("serviço traduz indisponibilidade e timeout do provedor", async () => {
  const offline = createAssistantService({ name: "offline", async respond() { throw new Error("network detail"); } });
  await assert.rejects(offline.respond("Olá"), (error) => error instanceof AssistantError && error.code === "PROVIDER_UNAVAILABLE");

  const slow = createAssistantService({ name: "slow", respond: () => new Promise(() => {}) }, { timeoutMs: 10 });
  await assert.rejects(slow.respond("Olá"), (error) => error instanceof AssistantError && error.code === "PROVIDER_TIMEOUT");
});

test("API local rejeita origem externa, corpo inválido e tamanho excessivo", async () => {
  let calls = 0;
  const api = createAssistantApi({ async respond(message) { calls += 1; return { message }; } });
  assert.equal((await api(request({ message: "oi" }, { origin: "https://example.com" }))).status, 403);
  assert.equal((await api(request("{"))).status, 400);
  assert.equal((await api(request("x".repeat(MAX_ASSISTANT_BODY_BYTES + 1)))).status, 413);
  assert.equal(calls, 0);
});

test("API recebe apenas mensagem e devolve resposta estruturada sem tocar no calendário", async () => {
  const api = createAssistantApi(createAssistantService(mockAssistantProvider));
  const response = await api(request({ message: "Pode me ajudar com a agenda?" }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    data: {
      provider: "mock",
      intent: "calendar_help",
      message: "Entendi que sua mensagem é sobre o calendário. Para consultar, use um comando estruturado /list_events ou /get_agenda_summary com datas explícitas. Não interpreto pedidos livres como comandos.",
    },
  });
});

const sampleEvents = Array.from({ length: 3 }, (_, index) => ({
  id: index + 1,
  title: `Evento ${index + 1}`,
  date: `2026-11-0${index + 1}`,
  endDate: `2026-11-0${index + 1}`,
  startTime: "09:00",
  endTime: "10:00",
  category: index === 0 ? "Trabalho" : "Pessoal",
}));

test("comando estruturado chama ferramenta de leitura e retorna eventos do repositório injetado", async () => {
  let query;
  const service = createAssistantService(mockAssistantProvider, {
    calendarRepository: { async list(range, limit) { query = { range, limit }; return sampleEvents; } },
  });
  const result = await service.respond('/list_events {"from":"2026-11-01","to":"2026-11-07"}');
  assert.deepEqual(query, { range: { from: "2026-11-01", to: "2026-11-07" }, limit: MAX_CALENDAR_TOOL_EVENTS + 1 });
  assert.equal(result.intent, "calendar_events");
  assert.deepEqual(result.data.events, sampleEvents);
  assert.equal(result.data.truncated, false);
});

test("linguagem natural não executa ferramenta e comando com argumento inválido não consulta", async () => {
  let calls = 0;
  const service = createAssistantService(mockAssistantProvider, { calendarRepository: { async list() { calls += 1; return []; } } });
  assert.equal((await service.respond("Mostre minha agenda de amanhã")).intent, "calendar_help");
  await assert.rejects(service.respond('/list_events {"from":"2026-11-01","to":"2026-11-07","limit":999}'), { code: "INVALID_TOOL_REQUEST" });
  assert.equal((await service.respond('/delete_event {"from":"2026-11-01","to":"2026-11-01"}')).intent, "unknown");
  await assert.rejects(executeCalendarReadTool("delete_event", { from: "2026-11-01", to: "2026-11-01" }, {
    async list() { calls += 1; return []; },
  }), { code: "INVALID_TOOL_REQUEST" });
  assert.equal(calls, 0);
});

test("valida intervalo de datas e limita quantidade de eventos", async () => {
  let requestedLimit;
  const tooMany = Array.from({ length: MAX_CALENDAR_TOOL_EVENTS + 1 }, (_, index) => ({ ...sampleEvents[0], id: index + 1 }));
  const repository = { async list(_range, limit) { requestedLimit = limit; return tooMany; } };
  await assert.rejects(executeCalendarReadTool("list_events", { from: "2026-11-01", to: "2026-12-02" }, repository), { code: "INVALID_TOOL_REQUEST" });
  assert.equal(MAX_CALENDAR_TOOL_RANGE_DAYS, 31);
  assert.equal(requestedLimit, undefined);
  const result = await executeCalendarReadTool("list_events", { from: "2026-11-01", to: "2026-11-01" }, repository);
  assert.equal(requestedLimit, MAX_CALENDAR_TOOL_EVENTS + 1);
  assert.equal(result.data.events.length, MAX_CALENDAR_TOOL_EVENTS);
  assert.equal(result.data.truncated, true);
});

test("resumo é calculado dos eventos consultados e falha do banco é normalizada", async () => {
  const result = await executeCalendarReadTool("get_agenda_summary", { from: "2026-11-01", to: "2026-11-07" }, {
    async list() { return sampleEvents; },
  });
  assert.equal(result.data.eventCount, 3);
  assert.deepEqual(result.data.byCategory, [{ category: "Pessoal", count: 2 }, { category: "Trabalho", count: 1 }]);
  await assert.rejects(executeCalendarReadTool("list_events", { from: "2026-11-01", to: "2026-11-01" }, {
    async list() { throw new Error("private database detail"); },
  }), (error) => error.code === "CALENDAR_UNAVAILABLE" && !error.message.includes("private"));
});

test("mock permanece padrão e Gemini exige seleção explícita", async () => {
  let geminiCreations = 0;
  const createGemini = () => { geminiCreations += 1; return { name: "gemini", async respond() { return { intent: "unknown", message: "ok" }; } }; };
  assert.equal(selectAssistantProvider({}, mockAssistantProvider, createGemini), mockAssistantProvider);
  assert.equal(geminiCreations, 0);
  const selected = selectAssistantProvider({ MORTUS_AI_PROVIDER: "gemini", GEMINI_API_KEY: "fake-key", GEMINI_MODEL: "test-model" }, mockAssistantProvider, (options) => {
    geminiCreations += 1;
    assert.deepEqual(options, { apiKey: "fake-key", model: "test-model" });
    return { name: "gemini", async respond() { return { intent: "unknown", message: "ok" }; } };
  });
  assert.equal(selected.name, "gemini");
  assert.equal(geminiCreations, 1);
});

test("adaptador Gemini usa modelo, data local, schemas permitidos e limite de saída sem enviar eventos", async () => {
  let request;
  let clientCreations = 0;
  let reserved = 0;
  const provider = createGeminiProviderCore({
    apiKey: "fake-secret",
    createClient(apiKey) {
      clientCreations += 1;
      assert.equal(apiKey, "fake-secret");
      return { models: { async generateContent(value) { request = value; return { text: "Pode informar a data?" }; } } };
    },
    limiter: { reserve() { reserved += 1; } },
    now: () => new Date("2026-01-01T02:00:00.000Z"),
  });
  const result = await provider.respond({ message: "Qual a agenda amanhã?", signal: new AbortController().signal });
  assert.equal(result.message, "Pode informar a data?");
  assert.equal(request.model, DEFAULT_GEMINI_MODEL);
  assert.equal(request.contents, "Qual a agenda amanhã?");
  assert.match(request.config.systemInstruction, /Data local atual: 2025-12-31/);
  assert.match(request.config.systemInstruction, new RegExp(GEMINI_TIME_ZONE));
  assert.equal(request.config.maxOutputTokens, GEMINI_MAX_OUTPUT_TOKENS);
  assert.equal(request.config.tools[0].functionDeclarations.length, 2);
  assert.deepEqual(request.config.tools[0].functionDeclarations.map(({ name }) => name), ["list_events", "get_agenda_summary"]);
  assert.equal(clientCreations, 1);
  assert.equal(reserved, 1);
});

test("Gemini function call passa pela validação local e não envia o resultado de eventos de volta ao modelo", async () => {
  let externalCalls = 0;
  let providerPayload;
  const provider = createGeminiProviderCore({
    apiKey: "fake-key",
    createClient: () => ({ models: { async generateContent(params) {
      externalCalls += 1;
      providerPayload = params;
      return { functionCalls: [{ name: "list_events", args: { from: "2026-11-01", to: "2026-11-02" } }] };
    } } }),
    limiter: { reserve() {} },
  });
  const service = createAssistantService(provider, { calendarRepository: { async list() { return sampleEvents.slice(0, 1); } } });
  const result = await service.respond("Minha agenda para o período");
  assert.equal(result.intent, "calendar_events");
  assert.deepEqual(result.data.events, sampleEvents.slice(0, 1));
  assert.equal(externalCalls, 1);
  assert.equal(providerPayload.contents, "Minha agenda para o período");
  assert.equal(JSON.stringify(providerPayload).includes("Evento 1"), false);
});

test("Gemini seleciona ferramentas de leitura para datas naturais usando o calendário de Manaus", async () => {
  const scenarios = [
    {
      message: "O que tenho amanhã?",
      tool: "list_events",
      args: { from: "2026-11-06", to: "2026-11-06" },
    },
    {
      message: "Quais são meus compromissos desta semana?",
      tool: "get_agenda_summary",
      args: { from: "2026-11-02", to: "2026-11-08" },
    },
    {
      message: "Quantas reuniões tenho nos próximos sete dias?",
      tool: "get_agenda_summary",
      args: { from: "2026-11-05", to: "2026-11-11" },
    },
    {
      message: "Mostre meus eventos de 5 a 7 de novembro.",
      tool: "list_events",
      args: { from: "2026-11-05", to: "2026-11-07" },
    },
  ];

  for (const scenario of scenarios) {
    let modelRequest;
    let repositoryRange;
    const provider = createGeminiProviderCore({
      apiKey: "fake-key",
      model: "gemini-3.1-flash-lite",
      now: () => new Date("2026-11-05T16:00:00.000Z"),
      limiter: { reserve() {} },
      createClient: () => ({ models: { async generateContent(params) {
        modelRequest = params;
        return { functionCalls: [{ name: scenario.tool, args: scenario.args }] };
      } } }),
    });
    const service = createAssistantService(provider, {
      calendarRepository: { async list(range) { repositoryRange = range; return []; } },
    });

    const result = await service.respond(scenario.message);
    assert.deepEqual(repositoryRange, scenario.args, scenario.message);
    assert.equal(modelRequest.model, "gemini-3.1-flash-lite");
    assert.equal(modelRequest.contents, scenario.message);
    assert.equal(modelRequest.config.toolConfig.functionCallingConfig.mode, "AUTO");
    assert.deepEqual(
      modelRequest.config.tools[0].functionDeclarations.map(({ name }) => name),
      ["list_events", "get_agenda_summary"],
    );
    assert.match(modelRequest.config.systemInstruction, /Data local atual: 2026-11-05/);
    assert.match(modelRequest.config.systemInstruction, /segunda-feira a domingo/);
    assert.match(modelRequest.config.systemInstruction, /hoje até hoje mais seis dias/);
    assert.equal(result.intent, scenario.tool === "list_events" ? "calendar_events" : "agenda_summary");
    assert.equal(JSON.stringify(modelRequest).includes("Evento 1"), false);
  }
});

test("Gemini tool calls com intervalos inválidos, argumentos extras ou escrita são recusados", async () => {
  const attempts = [
    { name: "list_events", args: { from: "2026-11-10", to: "2026-11-01" } },
    { name: "get_agenda_summary", args: { from: "2026-11-01", to: "2026-12-02" } },
    { name: "list_events", args: { from: "2026-11-01", to: "2026-11-02", sql: "SELECT *" } },
    { name: "create_event", args: { title: "Não permitido" } },
  ];
  let repositoryCalls = 0;

  for (const toolCall of attempts) {
    const provider = createGeminiProviderCore({
      apiKey: "fake-key",
      createClient: () => ({ models: { async generateContent() { return { functionCalls: [toolCall] }; } } }),
      limiter: { reserve() {} },
    });
    const service = createAssistantService(provider, {
      calendarRepository: { async list() { repositoryCalls += 1; return []; } },
    });

    await assert.rejects(service.respond("Consulte a agenda"), { code: "INVALID_TOOL_REQUEST" });
  }

  assert.equal(repositoryCalls, 0);
});
test("Gemini rejeita falta de chave, respostas inválidas, 429 e timeout", async () => {
  let clientCalls = 0;
  const create = (response, options = {}) => createGeminiProviderCore({
    apiKey: "fake-key",
    createClient: () => ({ models: { async generateContent() { clientCalls += 1; if (response instanceof Error) throw response; return response; } } }),
    limiter: { reserve() {} },
    ...options,
  });
  const missingKey = createGeminiProviderCore({ createClient: () => { throw new Error("should not construct client"); }, limiter: { reserve() { throw new Error("should not reserve"); } } });
  await assert.rejects(missingKey.respond({ message: "oi", signal: new AbortController().signal }), { code: "PROVIDER_NOT_CONFIGURED" });
  await assert.rejects(create({}).respond({ message: "oi", signal: new AbortController().signal }), { code: "PROVIDER_INVALID_RESPONSE" });
  await assert.rejects(create({ functionCalls: [{ name: "list_events", args: {} }, { name: "get_agenda_summary", args: {} }] }).respond({ message: "oi", signal: new AbortController().signal }), { code: "PROVIDER_INVALID_RESPONSE" });
  await assert.rejects(create(Object.assign(new Error("rate limit"), { status: 429 })).respond({ message: "oi", signal: new AbortController().signal }), { code: "PROVIDER_RATE_LIMITED" });
  assert.equal(clientCalls, 3);
  const hanging = createGeminiProviderCore({
    apiKey: "fake-key",
    createClient: () => ({ models: { generateContent: () => new Promise(() => {}) } }),
    limiter: { reserve() {} },
  });
  const service = createAssistantService(hanging, { timeoutMs: 10 });
  await assert.rejects(service.respond("oi"), { code: "PROVIDER_TIMEOUT" });
});

test("limiter reserva até 5 chamadas por minuto e 30 em 24 horas", () => {
  let now = 0;
  const limiter = new GeminiUsageLimiter(() => now);
  for (let index = 0; index < GEMINI_MAX_REQUESTS_PER_MINUTE; index += 1) limiter.reserve();
  assert.throws(() => limiter.reserve(), { code: "USAGE_LIMIT_EXCEEDED" });
  for (let batch = 1; batch < GEMINI_MAX_REQUESTS_PER_DAY / GEMINI_MAX_REQUESTS_PER_MINUTE; batch += 1) {
    now = batch * 60_001;
    for (let index = 0; index < GEMINI_MAX_REQUESTS_PER_MINUTE; index += 1) limiter.reserve();
  }
  assert.throws(() => limiter.reserve(), { code: "USAGE_LIMIT_EXCEEDED" });
  now = 24 * 60 * 60 * 1000 + 1;
  limiter.reserve();
});

test("API rejeita campos desconhecidos e mapeia falhas do serviço", async () => {
  const api = createAssistantApi({ async respond() { throw new AssistantError("PROVIDER_TIMEOUT", "timeout"); } });
  assert.equal((await api(request({ message: "oi", events: [] }))).status, 400);
  const timeout = await api(request({ message: "oi" }));
  assert.equal(timeout.status, 504);
  assert.equal((await timeout.json()).error.code, "PROVIDER_TIMEOUT");
});

test("classifica erros Gemini sem registrar mensagens, chave ou conteúdo privado", async () => {
  const cases = [
    { error: Object.assign(new Error("private key=secret-token"), { status: 401 }), code: "PROVIDER_AUTH_FAILED", category: "authentication", status: 401 },
    { error: Object.assign(new Error("API key not valid: secret-token"), { status: 400 }), code: "PROVIDER_AUTH_FAILED", category: "authentication", status: 400 },
    { error: Object.assign(new Error("model gemini-2.5-flash-lite not found"), { status: 404 }), code: "PROVIDER_MODEL_NOT_FOUND", category: "model_not_found", status: 404 },
    { error: Object.assign(new Error("quota exhausted"), { status: 429 }), code: "PROVIDER_RATE_LIMITED", category: "quota", status: 429 },
    { error: Object.assign(new Error("deadline"), { status: 504 }), code: "PROVIDER_TIMEOUT", category: "timeout", status: 504 },
    { error: Object.assign(new TypeError("fetch failed: private prompt"), { cause: Object.assign(new Error("network secret"), { code: "ECONNRESET" }) }), code: "PROVIDER_NETWORK_ERROR", category: "network" },
    { error: Object.assign(new Error("upstream"), { status: 503 }), code: "PROVIDER_UNAVAILABLE", category: "upstream_unavailable", status: 503 },
    { error: Object.assign(new Error("private event title and secret-token"), { status: 400 }), code: "PROVIDER_REQUEST_REJECTED", category: "request_rejected", status: 400 },
    { error: new Error("private event title and secret-token"), code: "PROVIDER_INTERNAL_ERROR", category: "internal" },
  ];
  const diagnostics = [];
  for (const scenario of cases) {
    const provider = createGeminiProviderCore({
      apiKey: "fake-secret-token",
      createClient: () => ({ models: { async generateContent() { throw scenario.error; } } }),
      limiter: { reserve() {} },
      onDiagnostic(diagnostic) { diagnostics.push(diagnostic); },
    });
    await assert.rejects(provider.respond({ message: "private user message", signal: new AbortController().signal }), { code: scenario.code });
  }
  assert.deepEqual(diagnostics, cases.map(({ category, status }) => ({ category, ...(status === undefined ? {} : { status }) })));
  assert.equal(JSON.stringify(diagnostics).includes("secret"), false);
  assert.equal(JSON.stringify(diagnostics).includes("private"), false);
});

test("API mantém respostas públicas genéricas para categorias internas do Gemini", async () => {
  for (const [code, status] of [["PROVIDER_AUTH_FAILED", 503], ["PROVIDER_MODEL_NOT_FOUND", 502], ["PROVIDER_NETWORK_ERROR", 503], ["PROVIDER_INTERNAL_ERROR", 500]]) {
    const api = createAssistantApi({ async respond() { throw new AssistantError(code, "safe public message"); } });
    const response = await api(request({ message: "oi" }));
    assert.equal(response.status, status, code);
    assert.equal((await response.json()).error.message, "safe public message", code);
  }
});
