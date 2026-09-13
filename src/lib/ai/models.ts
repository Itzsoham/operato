import "server-only";

import { google } from "@ai-sdk/google";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateObject, generateText, type LanguageModel } from "ai";
import type { z } from "zod";

import { AiError } from "@/lib/ai/errors";

/**
 * The primary and fallback model definitions for Operato.
 *
 * Model ids are configured here to avoid scattering model strings across the SQL step,
 * answer step, weekly cron, and inventory alerts. Everything imports from here.
 *
 * Primary Provider: Google Gemini via `@ai-sdk/google` (GOOGLE_GENERATIVE_AI_API_KEY).
 * Fallback Provider: OpenRouter via `@openrouter/ai-sdk-provider` (OPEN_ROUTER_AI_API_KEY).
 *
 * Models are lazily resolved at call time to prevent module import failures in environments
 * lacking API keys (tests, build steps, CI).
 */

function modelFromEnv(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

/**
 * Primary Google Gemini models:
 */
export const MODEL_INTERACTIVE = modelFromEnv(
  "GEMINI_MODEL",
  "gemini-flash-latest",
);
export const MODEL_CRON = modelFromEnv(
  "GEMINI_MODEL_CRON",
  "gemini-flash-lite-latest",
);

/**
 * Fallback OpenRouter models:
 */
export const MODEL_INTERACTIVE_FALLBACK = modelFromEnv(
  "OPENROUTER_MODEL",
  "google/gemini-2.5-flash",
);
export const MODEL_CRON_FALLBACK = modelFromEnv(
  "OPENROUTER_MODEL_CRON",
  "google/gemini-2.5-flash-lite",
);

export const DEFAULT_DAILY_QUERIES_PER_TENANT = 25;

export type AiTier = "interactive" | "cron";

/**
 * Lazily resolve the Google Gemini language model.
 */
export function getGoogleModel(modelName: string): LanguageModel {
  return google(modelName);
}

/**
 * Lazily resolve the OpenRouter language model.
 */
export function getOpenRouterModel(modelName: string): LanguageModel {
  const apiKey =
    process.env.OPEN_ROUTER_AI_API_KEY?.trim() ||
    process.env.OPENROUTER_API_KEY?.trim();
  const openrouter = createOpenRouter({
    apiKey,
    appName: "Operato",
  });
  return openrouter(modelName);
}

export type FallbackObjectOptions<T> = {
  tier: AiTier;
  schema: z.ZodType<T>;
  system?: string;
  prompt: string;
  temperature?: number;
  maxOutputTokens?: number;
};

export type FallbackTextOptions = {
  tier: AiTier;
  system?: string;
  prompt: string;
  temperature?: number;
  maxOutputTokens?: number;
};

/**
 * Execute `generateObject` with Google Gemini first, automatically falling back to
 * OpenRouter if Google Gemini fails or is unconfigured.
 */
export async function generateObjectWithFallback<T>(
  options: FallbackObjectOptions<T>,
): Promise<{ object: T; provider: "google" | "openrouter" }> {
  const primaryModelName =
    options.tier === "interactive" ? MODEL_INTERACTIVE : MODEL_CRON;
  const fallbackModelName =
    options.tier === "interactive"
      ? MODEL_INTERACTIVE_FALLBACK
      : MODEL_CRON_FALLBACK;

  const hasGoogleKey = Boolean(
    process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim(),
  );
  const hasOpenRouterKey = Boolean(
    process.env.OPEN_ROUTER_AI_API_KEY?.trim() ||
    process.env.OPENROUTER_API_KEY?.trim(),
  );

  let primaryError: unknown = null;

  if (hasGoogleKey) {
    try {
      const result = await generateObject({
        model: getGoogleModel(primaryModelName),
        schema: options.schema,
        system: options.system,
        prompt: options.prompt,
        temperature: options.temperature,
        maxOutputTokens: options.maxOutputTokens,
      });
      return { object: result.object, provider: "google" };
    } catch (error) {
      primaryError = error;
      console.warn(
        `[ai] Primary Google model (${primaryModelName}) failed: ${
          error instanceof Error ? error.message : String(error)
        }. Attempting fallback to OpenRouter (${fallbackModelName})...`,
      );
    }
  }

  if (hasOpenRouterKey) {
    try {
      const result = await generateObject({
        model: getOpenRouterModel(fallbackModelName),
        schema: options.schema,
        system: options.system,
        prompt: options.prompt,
        temperature: options.temperature,
        maxOutputTokens: options.maxOutputTokens,
      });
      return { object: result.object, provider: "openrouter" };
    } catch (fallbackError) {
      console.error(
        `[ai] Fallback OpenRouter model (${fallbackModelName}) also failed:`,
        fallbackError,
      );
      throw new AiError(
        503,
        "The assistant is unavailable right now. Try again shortly.",
        {
          cause: fallbackError,
        },
      );
    }
  }

  throw new AiError(
    503,
    "The assistant is unavailable right now. Try again shortly.",
    {
      cause:
        primaryError ??
        new Error(
          "No AI API keys configured (checked GOOGLE_GENERATIVE_AI_API_KEY and OPEN_ROUTER_AI_API_KEY)",
        ),
    },
  );
}

/**
 * Execute `generateText` with Google Gemini first, automatically falling back to
 * OpenRouter if Google Gemini fails or is unconfigured.
 */
export async function generateTextWithFallback(
  options: FallbackTextOptions,
): Promise<{ text: string; provider: "google" | "openrouter" }> {
  const primaryModelName =
    options.tier === "interactive" ? MODEL_INTERACTIVE : MODEL_CRON;
  const fallbackModelName =
    options.tier === "interactive"
      ? MODEL_INTERACTIVE_FALLBACK
      : MODEL_CRON_FALLBACK;

  const hasGoogleKey = Boolean(
    process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim(),
  );
  const hasOpenRouterKey = Boolean(
    process.env.OPEN_ROUTER_AI_API_KEY?.trim() ||
    process.env.OPENROUTER_API_KEY?.trim(),
  );

  let primaryError: unknown = null;

  if (hasGoogleKey) {
    try {
      const result = await generateText({
        model: getGoogleModel(primaryModelName),
        system: options.system,
        prompt: options.prompt,
        temperature: options.temperature,
        maxOutputTokens: options.maxOutputTokens,
      });
      return { text: result.text, provider: "google" };
    } catch (error) {
      primaryError = error;
      console.warn(
        `[ai] Primary Google model (${primaryModelName}) failed: ${
          error instanceof Error ? error.message : String(error)
        }. Attempting fallback to OpenRouter (${fallbackModelName})...`,
      );
    }
  }

  if (hasOpenRouterKey) {
    try {
      const result = await generateText({
        model: getOpenRouterModel(fallbackModelName),
        system: options.system,
        prompt: options.prompt,
        temperature: options.temperature,
        maxOutputTokens: options.maxOutputTokens,
      });
      return { text: result.text, provider: "openrouter" };
    } catch (fallbackError) {
      console.error(
        `[ai] Fallback OpenRouter model (${fallbackModelName}) also failed:`,
        fallbackError,
      );
      throw new AiError(
        503,
        "The assistant is unavailable right now. Try again shortly.",
        {
          cause: fallbackError,
        },
      );
    }
  }

  throw new AiError(
    503,
    "The assistant is unavailable right now. Try again shortly.",
    {
      cause:
        primaryError ??
        new Error(
          "No AI API keys configured (checked GOOGLE_GENERATIVE_AI_API_KEY and OPEN_ROUTER_AI_API_KEY)",
        ),
    },
  );
}
