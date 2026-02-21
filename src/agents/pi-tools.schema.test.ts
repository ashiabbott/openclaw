import { describe, expect, it } from "vitest";
import { normalizeToolParameters } from "./pi-tools.schema.js";

describe("normalizeToolParameters", () => {
  it("cleans unsupported schema keywords for google-antigravity", () => {
    const tool = {
      id: "demo",
      description: "demo",
      parameters: {
        type: "object",
        patternProperties: {
          "^x-": { type: "string" },
        },
        properties: {
          foo: {
            type: "string",
            format: "uuid",
          },
        },
      },
    } as const;

    const normalized = normalizeToolParameters(tool as never, {
      modelProvider: "google-antigravity",
    }) as { parameters: Record<string, unknown> };

    expect(normalized.parameters.patternProperties).toBeUndefined();
    const foo = (normalized.parameters.properties as Record<string, Record<string, unknown>>)?.foo;
    expect(foo?.format).toBeUndefined();
  });

  it("keeps full schema for anthropic provider", () => {
    const tool = {
      id: "demo",
      description: "demo",
      parameters: {
        type: "object",
        patternProperties: {
          "^x-": { type: "string" },
        },
      },
    } as const;

    const normalized = normalizeToolParameters(tool as never, {
      modelProvider: "anthropic",
    }) as { parameters: Record<string, unknown> };

    expect(normalized.parameters.patternProperties).toBeDefined();
  });
});
