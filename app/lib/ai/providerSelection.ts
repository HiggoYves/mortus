import { AssistantError, type AssistantProvider } from "./types.ts";

export type AssistantEnvironment = {
  MORTUS_AI_PROVIDER?: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
};

type GeminiFactory = (options: { apiKey?: string; model?: string }) => AssistantProvider;

export function selectAssistantProvider(
  env: AssistantEnvironment,
  mock: AssistantProvider,
  createGemini: GeminiFactory,
): AssistantProvider {
  const selection = env.MORTUS_AI_PROVIDER?.trim().toLowerCase() || "mock";
  if (selection === "mock") return mock;
  if (selection === "gemini") return createGemini({ apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL });
  return {
    name: "configuration-error",
    async respond() {
      throw new AssistantError("PROVIDER_NOT_CONFIGURED", "MORTUS_AI_PROVIDER deve ser mock ou gemini.");
    },
  };
}
