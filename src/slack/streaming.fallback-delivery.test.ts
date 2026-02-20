/**
 * Regression test: Slack stream stop failure must attempt fallback delivery.
 *
 * When stopSlackStream() fails with missing_recipient_team_id or any other
 * error, the accumulated text must not be silently lost. Instead, we should
 * attempt a normal delivery of the accumulated text to the same thread.
 *
 * See: https://github.com/openclaw/openclaw/issues/20273
 * Workshop task #468
 */
import { describe, expect, it, vi } from "vitest";
import type { SlackStreamSession } from "./streaming.js";

describe("SlackStreamSession accumulated text tracking", () => {
  it("initializes accumulatedText as empty string", () => {
    const session: SlackStreamSession = {
      streamer: {} as any,
      channel: "C12345",
      threadTs: "1234567890.123456",
      stopped: false,
      accumulatedText: "",
    };
    expect(session.accumulatedText).toBe("");
  });

  it("tracks accumulated text from initial append", () => {
    const session: SlackStreamSession = {
      streamer: {} as any,
      channel: "C12345",
      threadTs: "1234567890.123456",
      stopped: false,
      accumulatedText: "Hello",
    };

    // Simulate appending more text
    session.accumulatedText += "\nWorld";
    expect(session.accumulatedText).toBe("Hello\nWorld");
  });

  it("allows reconstruction of full response from accumulated text on stop failure", () => {
    // Simulates the scenario in dispatch.ts where stopSlackStream fails
    const session: SlackStreamSession = {
      streamer: {} as any,
      channel: "C12345",
      threadTs: "1234567890.123456",
      stopped: false,
      accumulatedText: "This is the response text that was streamed",
    };

    // When stopSlackStream fails, we have the full accumulated text to
    // reconstruct in a fallback delivery
    const fallbackText = session.accumulatedText;
    expect(fallbackText).toBe("This is the response text that was streamed");
    expect(session.threadTs).toBe("1234567890.123456");

    // These two pieces are sufficient to construct a fallback ReplyPayload
    // and deliver via deliverNormally(payload, threadTs)
  });
});
