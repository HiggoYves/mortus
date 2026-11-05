"use client";

import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import { requestAssistant } from "../lib/assistantClient.ts";
import { formatAssistantDate, type AssistantPresentation } from "../lib/assistantPresentation.ts";

type ChatMessage = {
  id: number;
  role: "user" | "assistant" | "error";
  text: string;
  presentation?: AssistantPresentation | null;
};

function ResultPresentation({ result }: { result: AssistantPresentation }) {
  if (result.kind === "events") {
    return <div className="assistant-result-card">
      <div className="assistant-result-range">{formatAssistantDate(result.from)} – {formatAssistantDate(result.to)}</div>
      {result.events.length === 0
        ? <p className="assistant-empty-result">Nenhum evento encontrado neste período.</p>
        : <ul className="assistant-event-results">
          {result.events.map((event) => <li key={event.id}>
            <strong>{event.title}</strong>
            <span>{formatAssistantDate(event.date)}{event.endDate !== event.date ? ` – ${formatAssistantDate(event.endDate)}` : ""}</span>
            <span>{event.startTime}–{event.endTime} · {event.category}</span>
          </li>)}
        </ul>}
      {result.truncated && <p className="assistant-truncated">A lista foi limitada a 100 eventos. Consulte um período menor para ver os demais.</p>}
    </div>;
  }

  return <div className="assistant-result-card">
    <div className="assistant-result-range">{formatAssistantDate(result.from)} – {formatAssistantDate(result.to)}</div>
    <strong className="assistant-summary-count">{result.eventCount} {result.eventCount === 1 ? "evento" : "eventos"}</strong>
    {result.eventCount === 0
      ? <p className="assistant-empty-result">A agenda está livre neste período.</p>
      : <>
        {result.byDate.length > 0 && <div className="assistant-summary-group"><span>Por dia</span><ul>{result.byDate.map(({ date, count }) => <li key={date}>{formatAssistantDate(date)}: {count}</li>)}</ul></div>}
        {result.byCategory.length > 0 && <div className="assistant-summary-group"><span>Por categoria</span><ul>{result.byCategory.map(({ category, count }) => <li key={category}>{category}: {count}</li>)}</ul></div>}
      </>}
  </div>;
}

export default function AssistantPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: 0, role: "assistant", text: "Olá! Posso consultar seus eventos e resumir a agenda. O assistente não cria nem altera eventos." },
  ]);
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const nextMessageId = useRef(1);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messages, isSending]);

  function appendMessage(message: Omit<ChatMessage, "id">) {
    const id = nextMessageId.current++;
    setMessages((current) => [...current, { ...message, id }]);
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = draft.trim();
    if (!message || isSending) return;

    appendMessage({ role: "user", text: message });
    setDraft("");
    setIsSending(true);

    try {
      const reply = await requestAssistant(message);
      appendMessage({ role: "assistant", text: reply.message, presentation: reply.presentation });
    } catch (error) {
      appendMessage({
        role: "error",
        text: error instanceof Error ? error.message : "Não foi possível enviar a mensagem. Tente novamente.",
      });
    } finally {
      setIsSending(false);
    }
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  return <aside id="mortus-assistant-panel" className="assistant-panel" aria-labelledby="assistant-title" hidden={!open}>
    <header className="assistant-panel-header">
      <div><div className="eyebrow">MORTUS AI</div><h2 id="assistant-title">Assistente</h2><p>Consultas somente leitura</p></div>
      <button className="assistant-close" type="button" onClick={onClose} aria-label="Fechar assistente">×</button>
    </header>

    <div className="assistant-messages" role="log" aria-label="Histórico da conversa" aria-live="polite" aria-relevant="additions text">
      {messages.map((message) => <article className={`assistant-message assistant-message-${message.role}`} key={message.id}>
        <span className="assistant-message-label">{message.role === "user" ? "Você" : message.role === "error" ? "Aviso" : "Mortus"}</span>
        <p>{message.text}</p>
        {message.presentation && <ResultPresentation result={message.presentation} />}
      </article>)}
      {isSending && <div className="assistant-loading" role="status"><span className="assistant-spinner" aria-hidden="true" />Consultando a agenda…</div>}
      <div ref={messagesEndRef} />
    </div>

    <form className="assistant-composer" onSubmit={(event) => { void sendMessage(event); }}>
      <label className="sr-only" htmlFor="assistant-message">Mensagem para o assistente</label>
      <textarea
        id="assistant-message"
        ref={inputRef}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleInputKeyDown}
        placeholder="Pergunte sobre sua agenda…"
        maxLength={2000}
        rows={2}
        disabled={isSending}
      />
      <div className="assistant-composer-footer">
        <span>{draft.length}/2000 · Enter envia</span>
        <button className="primary-button assistant-send" type="submit" disabled={isSending || draft.trim().length === 0}>
          {isSending ? "Enviando…" : "Enviar"}
        </button>
      </div>
    </form>
  </aside>;
}
