/**
 * Regression tests: buildAllowedModelSet must honour explicitly configured
 * models even when they are absent from the bundled model catalog.
 *
 * Scenario:
 *   - User has agents.defaults.models = { "anthropic/claude-sonnet-4-6": {} }
 *   - The bundled catalog only contains "claude-sonnet-4-5" (stale template)
 *   - Previously: gateway returned "model not allowed: anthropic/claude-sonnet-4-6"
 *     even though `openclaw models status` showed it in the allowlist
 *   - Previously: TUI dropdown showed "claude-sonnet-4-5" (stale), and selecting
 *     it would send the old ID which is also not in the allowlist
 *
 * Fix: explicitly configured models are always allowed regardless of catalog
 * status, and synthetic catalog entries are added so the TUI shows them.
 *
 * See: https://github.com/openclaw/openclaw/issues/20291
 * Workshop task #459
 */
import { describe, expect, it } from "vitest";
import { buildAllowedModelSet } from "./model-selection.js";
import type { ModelCatalogEntry } from "./model-catalog.js";

/** Minimal catalog with only the stale template model, not the current one. */
const STALE_CATALOG: ModelCatalogEntry[] = [
  { id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5", provider: "anthropic" },
  { id: "claude-opus-4-5", name: "Claude Opus 4.5", provider: "anthropic" },
  { id: "gpt-5.2", name: "GPT-5.2", provider: "openai" },
];

describe("buildAllowedModelSet — allowlist honours config over catalog", () => {
  it("allows a model that is in the config but NOT in the catalog", () => {
    const cfg = {
      agents: {
        defaults: {
          model: { primary: "anthropic/claude-sonnet-4-6" },
          models: {
            "anthropic/claude-sonnet-4-6": {},
          },
        },
      },
    } as any;

    const result = buildAllowedModelSet({
      cfg,
      catalog: STALE_CATALOG,
      defaultProvider: "anthropic",
      defaultModel: "claude-sonnet-4-6",
    });

    expect(result.allowAny).toBe(false);
    // The key must be in allowedKeys even though it's absent from the catalog
    expect(result.allowedKeys.has("anthropic/claude-sonnet-4-6")).toBe(true);
  });

  it("creates a synthetic catalog entry for a model in config but not catalog", () => {
    const cfg = {
      agents: {
        defaults: {
          models: {
            "anthropic/claude-sonnet-4-6": {},
          },
        },
      },
    } as any;

    const result = buildAllowedModelSet({
      cfg,
      catalog: STALE_CATALOG,
      defaultProvider: "anthropic",
    });

    // Should include the synthetic entry for claude-sonnet-4-6
    const synthetic = result.allowedCatalog.find((e) => e.id === "claude-sonnet-4-6");
    expect(synthetic).toBeDefined();
    expect(synthetic?.provider).toBe("anthropic");
  });

  it("does NOT create a synthetic entry for a model already in the catalog", () => {
    const cfg = {
      agents: {
        defaults: {
          models: {
            // This one is in the catalog
            "anthropic/claude-sonnet-4-5": {},
          },
        },
      },
    } as any;

    const result = buildAllowedModelSet({
      cfg,
      catalog: STALE_CATALOG,
      defaultProvider: "anthropic",
    });

    // Should not duplicate — only the real catalog entry
    const entries = result.allowedCatalog.filter((e) => e.id === "claude-sonnet-4-5");
    expect(entries).toHaveLength(1);
    // Real catalog entry has the proper name
    expect(entries[0].name).toBe("Claude Sonnet 4.5");
  });

  it("allows multiple allowlist models, mixing catalog and non-catalog", () => {
    const cfg = {
      agents: {
        defaults: {
          models: {
            "anthropic/claude-sonnet-4-6": {},  // NOT in catalog
            "anthropic/claude-opus-4-5": {},    // IS in catalog
            "openai/gpt-5.2": {},               // IS in catalog
          },
        },
      },
    } as any;

    const result = buildAllowedModelSet({
      cfg,
      catalog: STALE_CATALOG,
      defaultProvider: "anthropic",
    });

    expect(result.allowedKeys.has("anthropic/claude-sonnet-4-6")).toBe(true);
    expect(result.allowedKeys.has("anthropic/claude-opus-4-5")).toBe(true);
    expect(result.allowedKeys.has("openai/gpt-5.2")).toBe(true);
    // Three entries in allowedCatalog: 2 real + 1 synthetic
    expect(result.allowedCatalog).toHaveLength(3);
  });

  it("does NOT allow a model that is not in the config allowlist, even if in catalog", () => {
    const cfg = {
      agents: {
        defaults: {
          models: {
            "anthropic/claude-sonnet-4-6": {},
          },
        },
      },
    } as any;

    const result = buildAllowedModelSet({
      cfg,
      catalog: STALE_CATALOG,
      defaultProvider: "anthropic",
    });

    // claude-sonnet-4-5 is in the catalog but NOT in the config allowlist
    expect(result.allowedKeys.has("anthropic/claude-sonnet-4-5")).toBe(false);
  });

  it("returns allowAny=true when no models are configured (open allowlist)", () => {
    const cfg = { agents: { defaults: {} } } as any;

    const result = buildAllowedModelSet({
      cfg,
      catalog: STALE_CATALOG,
      defaultProvider: "anthropic",
    });

    expect(result.allowAny).toBe(true);
  });
});
