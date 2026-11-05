import { assistantHttpErrorMessage, parseAssistantPresentation, type AssistantPresentation } from "./assistantPresentation.ts";

export type AssistantReply = {
  message: string;
  presentation: AssistantPresentation | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function requestAssistant(
  message: string,
  fetcher: typeof fetch = fetch,
): Promise<AssistantReply> {
  let response: Response;
  try {
    response = await fetcher("/api/assistant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
      cache: "no-store",
    });
  } catch {
    throw new Error("Não foi possível conectar ao assistente. Verifique se o Mortus está disponível e tente novamente.");
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const errorObject = isRecord(payload) && isRecord(payload.error) ? payload.error : {};
    const code = typeof errorObject.code === "string" ? errorObject.code : null;
    throw new Error(assistantHttpErrorMessage(response.status, code));
  }

  const responseData = isRecord(payload) && isRecord(payload.data) ? payload.data : null;
  if (!responseData || typeof responseData.message !== "string") {
    throw new Error("O assistente retornou uma resposta inesperada. Tente novamente.");
  }

  return {
    message: responseData.message,
    presentation: parseAssistantPresentation(responseData.intent, responseData.data),
  };
}
