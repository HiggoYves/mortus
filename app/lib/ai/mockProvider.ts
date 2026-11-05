import type { AssistantProvider, AssistantProviderRequest, AssistantProviderResponse } from "./types.ts";

/** Deterministic local provider. It never receives events or accesses persistence. */
export const mockAssistantProvider: AssistantProvider = {
  name: "mock",
  async respond({ message, signal }: AssistantProviderRequest): Promise<AssistantProviderResponse> {
    if (signal.aborted) throw new DOMException("A solicitação foi cancelada.", "AbortError");

    const normalized = message.trim().toLocaleLowerCase("pt-BR");
    const command = /^\/(list_events|get_agenda_summary)\s+([\s\S]+)$/.exec(message.trim());
    if (command) {
      try {
        return {
          intent: "calendar_help",
          message: "Vou executar a consulta de leitura solicitada.",
          toolCall: { name: command[1], arguments: JSON.parse(command[2]) },
        };
      } catch {
        return {
          intent: "calendar_help",
          message: 'JSON inválido. Use, por exemplo: /list_events {"from":"2026-11-01","to":"2026-11-07"}.',
        };
      }
    }
    if (/^(oi|olá|ola|bom dia|boa tarde|boa noite)(\b|[!,?.])/.test(normalized)) {
      return { intent: "greeting", message: "Olá! Sou o assistente de teste do Mortus. Ainda não consulto sua agenda." };
    }
    if (/agenda|calendário|calendario|evento|compromisso/.test(normalized)) {
      return { intent: "calendar_help", message: "Entendi que sua mensagem é sobre o calendário. Para consultar, use um comando estruturado /list_events ou /get_agenda_summary com datas explícitas. Não interpreto pedidos livres como comandos." };
    }
    return { intent: "unknown", message: "Recebi sua mensagem. Sou um provedor simulado e ainda não tenho integração com um modelo de IA." };
  },
};
