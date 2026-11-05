import "server-only";
import { GoogleGenAI } from "@google/genai";
import { createGeminiProviderCore, type GeminiProviderOptions } from "./geminiProviderCore.ts";
import type { AssistantProvider } from "./types.ts";

export type GeminiServerProviderOptions = Omit<GeminiProviderOptions, "createClient">;

export function createGeminiProvider(options: GeminiServerProviderOptions): AssistantProvider {
  return createGeminiProviderCore({
    ...options,
    createClient: (apiKey) => new GoogleGenAI({ apiKey }),
  });
}
