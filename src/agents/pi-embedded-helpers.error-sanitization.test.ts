/**
 * Regression tests for transient LLM API error sanitization.
 *
 * Ensures raw provider error details (api_error type, request_id, internal
 * error messages) are never forwarded to end users via messaging channels.
 *
 * See: https://github.com/openclaw/openclaw/issues/20250
 */
import { describe, expect, it } from "vitest";
import {
  formatAssistantErrorText,
  formatRawAssistantErrorForUi,
} from "./pi-embedded-helpers.js";
import { makeAssistantMessageFixture } from "./test-helpers/assistant-message-fixtures.js";
import type { AssistantMessage } from "@mariozechner/pi-ai";

const TRANSIENT_MESSAGE =
  "The AI service encountered a temporary error. Please try again in a moment.";

function makeError(errorMessage: string): AssistantMessage {
  return makeAssistantMessageFixture({
    errorMessage,
    content: [{ type: "text", text: errorMessage }],
  });
}

describe("formatRawAssistantErrorForUi — transient error sanitization", () => {
  it("returns generic message for Anthropic api_error (exact bug scenario from issue #20250)", () => {
    // This is the raw payload that was being delivered to WhatsApp:
    // "LLM error api_error: Internal server error (request_id: req_011CYFmpt8r8CFFmnpgGL5cQ)"
    const raw =
      '{"type":"error","error":{"type":"api_error","message":"Internal server error"},"request_id":"req_011CYFmpt8r8CFFmnpgGL5cQ"}';
    const result = formatRawAssistantErrorForUi(raw);
    expect(result).toBe(TRANSIENT_MESSAGE);
    expect(result).not.toContain("request_id");
    expect(result).not.toContain("req_011CYFmpt8r8CFFmnpgGL5cQ");
    expect(result).not.toContain("api_error");
  });

  it("returns generic message for api_error with HTTP 500 prefix", () => {
    const raw =
      '500 {"type":"error","error":{"type":"api_error","message":"Internal server error"},"request_id":"req_abc"}';
    expect(formatRawAssistantErrorForUi(raw)).toBe(TRANSIENT_MESSAGE);
  });

  it("returns generic message for internal_error type", () => {
    const raw =
      '{"type":"error","error":{"type":"internal_error","message":"Unexpected failure"}}';
    expect(formatRawAssistantErrorForUi(raw)).toBe(TRANSIENT_MESSAGE);
  });

  it("returns generic message for server_error type", () => {
    const raw =
      '{"type":"error","error":{"type":"server_error","message":"Service temporarily unavailable"}}';
    expect(formatRawAssistantErrorForUi(raw)).toBe(TRANSIENT_MESSAGE);
  });

  it("returns generic message for internal_server_error type", () => {
    const raw =
      '{"type":"error","error":{"type":"internal_server_error","message":"An error occurred"}}';
    expect(formatRawAssistantErrorForUi(raw)).toBe(TRANSIENT_MESSAGE);
  });

  it("returns generic message for plain HTTP 500", () => {
    expect(formatRawAssistantErrorForUi("500 Internal Server Error")).toBe(TRANSIENT_MESSAGE);
  });

  it("returns generic message for HTTP 502 and 503", () => {
    expect(formatRawAssistantErrorForUi("502 Bad Gateway")).toBe(TRANSIENT_MESSAGE);
    expect(formatRawAssistantErrorForUi("503 Service Unavailable")).toBe(TRANSIENT_MESSAGE);
  });

  it("never includes request_id in any formatted output", () => {
    // Even for non-transient errors (e.g. 429 rate limit), request_id
    // is an internal provider detail that should not reach end users.
    const raw =
      '429 {"type":"error","error":{"type":"rate_limit_error","message":"Rate limited."},"request_id":"req_should_not_appear"}';
    const result = formatRawAssistantErrorForUi(raw);
    expect(result).not.toContain("req_should_not_appear");
    expect(result).not.toContain("request_id");
  });

  it("still shows actionable client error details for non-transient errors", () => {
    // 401/403 are not transient — users need to know their API key is wrong.
    expect(formatRawAssistantErrorForUi("400 Bad Request")).toBe("HTTP 400: Bad Request");
  });
});

describe("formatAssistantErrorText — transient server error sanitization", () => {
  it("never sends raw api_error details to end users (exact bug from issue #20250)", () => {
    const raw =
      '{"type":"error","error":{"type":"api_error","message":"Internal server error"},"request_id":"req_011CYFmpt8r8CFFmnpgGL5cQ"}';
    const result = formatAssistantErrorText(makeError(raw));
    expect(result).toBe(TRANSIENT_MESSAGE);
    expect(result).not.toContain("req_011CYFmpt8r8CFFmnpgGL5cQ");
    expect(result).not.toContain("api_error");
    expect(result).not.toContain("Internal server error");
  });

  it("never sends raw internal_server_error details to end users", () => {
    const raw =
      '{"type":"error","error":{"type":"internal_server_error","message":"Something broke"},"request_id":"req_xyz"}';
    const result = formatAssistantErrorText(makeError(raw));
    expect(result).toBe(TRANSIENT_MESSAGE);
    expect(result).not.toContain("req_xyz");
  });

  it("never sends raw server_error details to end users", () => {
    const raw =
      '{"type":"error","error":{"type":"server_error","message":"Server crashed"},"request_id":"req_123"}';
    const result = formatAssistantErrorText(makeError(raw));
    expect(result).toBe(TRANSIENT_MESSAGE);
  });

  it("still returns rate limit friendly copy (not swallowed by transient check)", () => {
    const raw =
      '{"type":"error","error":{"type":"rate_limit_error","message":"Too many requests"},"request_id":"req_abc"}';
    const result = formatAssistantErrorText(makeError(raw));
    expect(result).toContain("rate limit");
    expect(result).not.toContain("req_abc");
  });

  it("still returns overloaded friendly copy", () => {
    const raw =
      '{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"},"request_id":"req_123"}';
    const result = formatAssistantErrorText(makeError(raw));
    expect(result).toContain("overloaded");
    expect(result).not.toContain("req_123");
  });
});
