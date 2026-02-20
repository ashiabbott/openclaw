/**
 * Regression test: Ollama provider-level `api` override must be
 * inherited by discovered models that have api=undefined.
 *
 * See: https://github.com/openclaw/openclaw/issues/20259
 * Workshop task #472
 */
import { describe, expect, it } from "vitest";
import { buildInlineProviderModels } from "./model.js";

describe("buildInlineProviderModels — Ollama api inheritance", () => {
  it("inherits api from provider config when model has no api", () => {
    const providers = {
      ollama: {
        baseUrl: "http://127.0.0.1:11434/v1",
        api: "openai-completions" as const,
        models: [
          {
            id: "qwen2.5-coder:7b",
            name: "qwen2.5-coder:7b",
            reasoning: false,
            input: ["text" as const],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 128000,
            maxTokens: 8192,
            // No `api` field on the model — should inherit from provider.
          },
        ],
      },
    };

    const result = buildInlineProviderModels(providers);
    expect(result).toHaveLength(1);
    expect(result[0].api).toBe("openai-completions");
    expect(result[0].provider).toBe("ollama");
    expect(result[0].id).toBe("qwen2.5-coder:7b");
  });

  it("preserves model-level api when it differs from provider", () => {
    const providers = {
      ollama: {
        baseUrl: "http://127.0.0.1:11434/v1",
        api: "openai-completions" as const,
        models: [
          {
            id: "custom-model",
            name: "custom-model",
            api: "ollama" as const,
            reasoning: false,
            input: ["text" as const],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 128000,
            maxTokens: 8192,
          },
        ],
      },
    };

    const result = buildInlineProviderModels(providers);
    expect(result[0].api).toBe("ollama");
  });

  it("defaults to undefined api when neither model nor provider specifies it", () => {
    const providers = {
      custom: {
        baseUrl: "http://custom:8080",
        models: [
          {
            id: "some-model",
            name: "some-model",
            reasoning: false,
            input: ["text" as const],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 4096,
            maxTokens: 4096,
          },
        ],
      },
    };

    const result = buildInlineProviderModels(providers);
    expect(result[0].api).toBeUndefined();
  });
});
