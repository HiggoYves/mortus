import "server-only";
import { mockAssistantProvider } from "./mockProvider.ts";
import { createGeminiProvider } from "./geminiProvider.ts";
import { selectAssistantProvider } from "./providerSelection.ts";

export function createConfiguredAssistantProvider(env: NodeJS.ProcessEnv) {
  return selectAssistantProvider({
    MORTUS_AI_PROVIDER: env.MORTUS_AI_PROVIDER,
    GEMINI_API_KEY: env.GEMINI_API_KEY,
    GEMINI_MODEL: env.GEMINI_MODEL,
  }, mockAssistantProvider, createGeminiProvider);
}
