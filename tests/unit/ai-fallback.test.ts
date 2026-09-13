import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { AiError } from "@/lib/ai/errors";
import {
  generateObjectWithFallback,
  generateTextWithFallback,
  MODEL_CRON,
  MODEL_CRON_FALLBACK,
  MODEL_INTERACTIVE,
  MODEL_INTERACTIVE_FALLBACK,
} from "@/lib/ai/models";

// Mock the AI SDK and provider calls
vi.mock("ai", () => ({
  generateObject: vi.fn(),
  generateText: vi.fn(),
}));

vi.mock("@ai-sdk/google", () => ({
  google: vi.fn((model: string) => ({ provider: "google", modelId: model })),
}));

vi.mock("@openrouter/ai-sdk-provider", () => ({
  createOpenRouter: vi.fn(() => (model: string) => ({
    provider: "openrouter",
    modelId: model,
  })),
}));

describe("AI Fallback System", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test-google-key";
    process.env.OPEN_ROUTER_AI_API_KEY = "test-openrouter-key";
  });

  describe("model definitions", () => {
    it("has primary Google models and OpenRouter fallback models configured", () => {
      expect(MODEL_INTERACTIVE).toBeDefined();
      expect(MODEL_CRON).toBeDefined();
      expect(MODEL_INTERACTIVE_FALLBACK).toBeDefined();
      expect(MODEL_CRON_FALLBACK).toBeDefined();
    });
  });

  describe("generateObjectWithFallback", () => {
    const testSchema = z.object({
      sql: z.string(),
      explanation: z.string(),
    });

    it("returns result from Google when primary call succeeds", async () => {
      const { generateObject } = await import("ai");
      vi.mocked(generateObject).mockResolvedValueOnce({
        object: { sql: "SELECT 1", explanation: "test" },
      } as never);

      const result = await generateObjectWithFallback({
        tier: "interactive",
        schema: testSchema,
        prompt: "How many orders today?",
      });

      expect(result.provider).toBe("google");
      expect(result.object).toEqual({ sql: "SELECT 1", explanation: "test" });
      expect(generateObject).toHaveBeenCalledTimes(1);
    });

    it("falls back to OpenRouter when Google fails", async () => {
      const { generateObject } = await import("ai");
      // 1st call (Google) fails
      vi.mocked(generateObject).mockRejectedValueOnce(
        new Error("Google 429 Quota Exceeded"),
      );
      // 2nd call (OpenRouter) succeeds
      vi.mocked(generateObject).mockResolvedValueOnce({
        object: { sql: "SELECT 2", explanation: "fallback test" },
      } as never);

      const result = await generateObjectWithFallback({
        tier: "interactive",
        schema: testSchema,
        prompt: "How many orders today?",
      });

      expect(result.provider).toBe("openrouter");
      expect(result.object).toEqual({
        sql: "SELECT 2",
        explanation: "fallback test",
      });
      expect(generateObject).toHaveBeenCalledTimes(2);
    });

    it("throws AiError(503) when both Google and OpenRouter fail", async () => {
      const { generateObject } = await import("ai");
      vi.mocked(generateObject)
        .mockRejectedValueOnce(new Error("Google failed"))
        .mockRejectedValueOnce(new Error("OpenRouter failed"));

      await expect(
        generateObjectWithFallback({
          tier: "interactive",
          schema: testSchema,
          prompt: "How many orders today?",
        }),
      ).rejects.toThrow(AiError);
    });
  });

  describe("generateTextWithFallback", () => {
    it("returns result from Google when primary call succeeds", async () => {
      const { generateText } = await import("ai");
      vi.mocked(generateText).mockResolvedValueOnce({
        text: "You had 45 orders today.",
      } as never);

      const result = await generateTextWithFallback({
        tier: "cron",
        prompt: "Summarize weekly sales",
      });

      expect(result.provider).toBe("google");
      expect(result.text).toBe("You had 45 orders today.");
      expect(generateText).toHaveBeenCalledTimes(1);
    });

    it("falls back to OpenRouter when Google fails", async () => {
      const { generateText } = await import("ai");
      // 1st call (Google) fails
      vi.mocked(generateText).mockRejectedValueOnce(
        new Error("Google model no longer available"),
      );
      // 2nd call (OpenRouter) succeeds
      vi.mocked(generateText).mockResolvedValueOnce({
        text: "Summary via OpenRouter",
      } as never);

      const result = await generateTextWithFallback({
        tier: "cron",
        prompt: "Summarize weekly sales",
      });

      expect(result.provider).toBe("openrouter");
      expect(result.text).toBe("Summary via OpenRouter");
      expect(generateText).toHaveBeenCalledTimes(2);
    });

    it("throws AiError(503) when both providers fail", async () => {
      const { generateText } = await import("ai");
      vi.mocked(generateText)
        .mockRejectedValueOnce(new Error("Google error"))
        .mockRejectedValueOnce(new Error("OpenRouter error"));

      await expect(
        generateTextWithFallback({
          tier: "cron",
          prompt: "Summarize weekly sales",
        }),
      ).rejects.toThrow(AiError);
    });
  });
});
