import { AssistantError } from "./types.ts";

export const GEMINI_MAX_REQUESTS_PER_MINUTE = 5;
export const GEMINI_MAX_REQUESTS_PER_DAY = 30;
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

export class GeminiUsageLimiter {
  private timestamps: number[] = [];
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  reserve(): void {
    const currentTime = this.now();
    this.timestamps = this.timestamps.filter((timestamp) => currentTime - timestamp < DAY_MS);
    const lastMinute = this.timestamps.filter((timestamp) => currentTime - timestamp < MINUTE_MS).length;
    if (lastMinute >= GEMINI_MAX_REQUESTS_PER_MINUTE || this.timestamps.length >= GEMINI_MAX_REQUESTS_PER_DAY) {
      throw new AssistantError("USAGE_LIMIT_EXCEEDED", "Limite local do Gemini atingido. Aguarde antes de tentar novamente.");
    }
    this.timestamps.push(currentTime);
  }
}

// Shared by routes in this Node.js process. The counters reset when the process restarts.
export const geminiUsageLimiter = new GeminiUsageLimiter();
