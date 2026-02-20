import type { AssistantMessage } from "@mariozechner/pi-ai";
import { describe, expect, it } from "vitest";
import {
  BILLING_ERROR_USER_MESSAGE,
  formatBillingErrorMessage,
  formatAssistantErrorText,
  formatRawAssistantErrorForUi,
} from "./pi-embedded-helpers.js";
import { makeAssistantMessageFixture } from "./test-helpers/assistant-message-fixtures.js";

describe("formatAssistantErrorText", () => {
  const makeAssistantError = (errorMessage: string): AssistantMessage =>
    makeAssistantMessageFixture({
      errorMessage,
      content: [{ type: "text", text: errorMessage }],
    });

  it("returns a friendly message for context overflow", () => {
    const msg = makeAssistantError("request_too_large");
    expect(formatAssistantErrorText(msg)).toContain("Context overflow");
  });
  it("returns context overflow for Anthropic 'Request size exceeds model context window'", () => {
    // This is the new Anthropic error format that wasn't being detected.
    // Without the fix, this falls through to the invalidRequest regex and returns
    // "LLM request rejected: Request size exceeds model context window"
    // instead of the context overflow message, preventing auto-compaction.
    const msg = makeAssistantError(
      '{"type":"error","error":{"type":"invalid_request_error","message":"Request size exceeds model context window"}}',
    );
    expect(formatAssistantErrorText(msg)).toContain("Context overflow");
  });
  it("returns a friendly message for Anthropic role ordering", () => {
    const msg = makeAssistantError('messages: roles must alternate between "user" and "assistant"');
    expect(formatAssistantErrorText(msg)).toContain("Message ordering conflict");
  });
  it("returns a friendly message for Anthropic overload errors", () => {
    const msg = makeAssistantError(
      '{"type":"error","error":{"details":null,"type":"overloaded_error","message":"Overloaded"},"request_id":"req_123"}',
    );
    expect(formatAssistantErrorText(msg)).toBe(
      "The AI service is temporarily overloaded. Please try again in a moment.",
    );
  });
  it("returns a recovery hint when tool call input is missing", () => {
    const msg = makeAssistantError("tool_use.input: Field required");
    const result = formatAssistantErrorText(msg);
    expect(result).toContain("Session history looks corrupted");
    expect(result).toContain("/new");
  });
  it("handles JSON-wrapped role errors", () => {
    const msg = makeAssistantError('{"error":{"message":"400 Incorrect role information"}}');
    const result = formatAssistantErrorText(msg);
    expect(result).toContain("Message ordering conflict");
    expect(result).not.toContain("400");
  });
  it("returns a generic transient error message for server_error API payloads", () => {
    // server_error is a transient provider-side failure — raw details must never
    // reach end users (request IDs, internal type names, error messages).
    const msg = makeAssistantError(
      '{"type":"error","error":{"message":"Something exploded","type":"server_error"}}',
    );
    expect(formatAssistantErrorText(msg)).toBe(
      "The AI service encountered a temporary error. Please try again in a moment.",
    );
  });
  it("returns a friendly billing message for credit balance errors", () => {
    const msg = makeAssistantError("Your credit balance is too low to access the Anthropic API.");
    const result = formatAssistantErrorText(msg);
    expect(result).toBe(BILLING_ERROR_USER_MESSAGE);
  });
  it("returns a friendly billing message for HTTP 402 errors", () => {
    const msg = makeAssistantError("HTTP 402 Payment Required");
    const result = formatAssistantErrorText(msg);
    expect(result).toBe(BILLING_ERROR_USER_MESSAGE);
  });
  it("returns a friendly billing message for insufficient credits", () => {
    const msg = makeAssistantError("insufficient credits");
    const result = formatAssistantErrorText(msg);
    expect(result).toBe(BILLING_ERROR_USER_MESSAGE);
  });
  it("includes provider and assistant model in billing message when provider is given", () => {
    const msg = makeAssistantError("insufficient credits");
    const result = formatAssistantErrorText(msg, { provider: "Anthropic" });
    expect(result).toBe(formatBillingErrorMessage("Anthropic", "test-model"));
    expect(result).toContain("Anthropic");
    expect(result).not.toContain("API provider");
  });
  it("uses the active assistant model for billing message context", () => {
    const msg = makeAssistantError("insufficient credits");
    msg.model = "claude-3-5-sonnet";
    const result = formatAssistantErrorText(msg, { provider: "Anthropic" });
    expect(result).toBe(formatBillingErrorMessage("Anthropic", "claude-3-5-sonnet"));
  });
  it("returns generic billing message when provider is not given", () => {
    const msg = makeAssistantError("insufficient credits");
    const result = formatAssistantErrorText(msg);
    expect(result).toContain("API provider");
    expect(result).toBe(BILLING_ERROR_USER_MESSAGE);
  });
  it("returns a friendly message for rate limit errors", () => {
    const msg = makeAssistantError("429 rate limit reached");
    expect(formatAssistantErrorText(msg)).toContain("rate limit reached");
  });

  it("returns a friendly message for empty stream chunk errors", () => {
    const msg = makeAssistantError("request ended without sending any chunks");
    expect(formatAssistantErrorText(msg)).toBe("LLM request timed out.");
  });
});

describe("formatRawAssistantErrorForUi", () => {
  it("renders HTTP code + type + message from Anthropic payloads (no request_id leaked)", () => {
    const text = formatRawAssistantErrorForUi(
      '429 {"type":"error","error":{"type":"rate_limit_error","message":"Rate limited."},"request_id":"req_123"}',
    );

    expect(text).toContain("HTTP 429");
    expect(text).toContain("rate_limit_error");
    expect(text).toContain("Rate limited.");
    // request_id is an internal provider detail — must not appear in user-facing output.
    expect(text).not.toContain("req_123");
    expect(text).not.toContain("request_id");
  });

  it("renders a generic unknown error message when raw is empty", () => {
    expect(formatRawAssistantErrorForUi("")).toContain("unknown error");
  });

  it("returns a generic transient message for HTTP 500 errors", () => {
    // HTTP 500 is a transient server error — raw details must not reach end users.
    expect(formatRawAssistantErrorForUi("500 Internal Server Error")).toBe(
      "The AI service encountered a temporary error. Please try again in a moment.",
    );
  });

  it("formats non-transient HTTP status lines as-is", () => {
    // Client errors (4xx, except known ones) should still surface the raw message
    // so users can act on them (e.g., 401 Unauthorized → they know to check API key).
    expect(formatRawAssistantErrorForUi("400 Bad Request")).toBe("HTTP 400: Bad Request");
  });

  it("sanitizes HTML error pages into a clean unavailable message", () => {
    const htmlError = `521 <!DOCTYPE html>
<html lang="en-US">
  <head><title>Web server is down | example.com | Cloudflare</title></head>
  <body>Ray ID: abc123</body>
</html>`;

    expect(formatRawAssistantErrorForUi(htmlError)).toBe(
      "The AI service is temporarily unavailable (HTTP 521). Please try again in a moment.",
    );
  });

  // Regression: https://github.com/openclaw/openclaw/issues/20250
  // Transient server errors (api_error, internal_error, server_error) must
  // never expose raw provider details — type names, messages, request IDs —
  // to end users via WhatsApp or other messaging channels.

  it("returns generic message for Anthropic api_error (exact bug scenario)", () => {
    const raw =
      '{"type":"error","error":{"type":"api_error","message":"Internal server error"},"request_id":"req_011CYFmpt8r8CFFmnpgGL5cQ"}';
    const result = formatRawAssistantErrorForUi(raw);
    expect(result).toBe(
      "The AI service encountered a temporary error. Please try again in a moment.",
    );
    expect(result).not.toContain("request_id");
    expect(result).not.toContain("req_011CYFmpt8r8CFFmnpgGL5cQ");
    expect(result).not.toContain("api_error");
  });

  it("returns generic message for api_error with HTTP 500 prefix", () => {
    const raw =
      '500 {"type":"error","error":{"type":"api_error","message":"Internal server error"},"request_id":"req_abc"}';
    const result = formatRawAssistantErrorForUi(raw);
    expect(result).toBe(
      "The AI service encountered a temporary error. Please try again in a moment.",
    );
    expect(result).not.toContain("req_abc");
  });

  it("returns generic message for internal_error type", () => {
    const raw = '{"type":"error","error":{"type":"internal_error","message":"Unexpected failure"}}';
    expect(formatRawAssistantErrorForUi(raw)).toBe(
      "The AI service encountered a temporary error. Please try again in a moment.",
    );
  });

  it("returns generic message for HTTP 502 and 503 errors", () => {
    expect(formatRawAssistantErrorForUi("502 Bad Gateway")).toBe(
      "The AI service encountered a temporary error. Please try again in a moment.",
    );
    expect(formatRawAssistantErrorForUi("503 Service Unavailable")).toBe(
      "The AI service encountered a temporary error. Please try again in a moment.",
    );
  });
});

describe("formatAssistantErrorText — transient server error sanitization", () => {
  const makeAssistantError = (errorMessage: string): import("@mariozechner/pi-ai").AssistantMessage =>
    makeAssistantMessageFixture({
      errorMessage,
      content: [{ type: "text", text: errorMessage }],
    });

  // Regression: https://github.com/openclaw/openclaw/issues/20250
  it("never sends raw api_error details to end users", () => {
    const raw =
      '{"type":"error","error":{"type":"api_error","message":"Internal server error"},"request_id":"req_011CYFmpt8r8CFFmnpgGL5cQ"}';
    const result = formatAssistantErrorText(makeAssistantError(raw));
    expect(result).toBe(
      "The AI service encountered a temporary error. Please try again in a moment.",
    );
    expect(result).not.toContain("req_011CYFmpt8r8CFFmnpgGL5cQ");
    expect(result).not.toContain("api_error");
  });

  it("never sends raw internal_server_error details to end users", () => {
    const raw =
      '{"type":"error","error":{"type":"internal_server_error","message":"Something went wrong"},"request_id":"req_xyz"}';
    const result = formatAssistantErrorText(makeAssistantError(raw));
    expect(result).toBe(
      "The AI service encountered a temporary error. Please try again in a moment.",
    );
    expect(result).not.toContain("req_xyz");
  });

  it("still surfaces rate limit errors with friendly copy", () => {
    const msg = makeAssistantError(
      '{"type":"error","error":{"type":"rate_limit_error","message":"Too many requests"},"request_id":"req_abc"}',
    );
    const result = formatAssistantErrorText(msg);
    expect(result).toContain("rate limit");
    expect(result).not.toContain("req_abc");
  });
});
