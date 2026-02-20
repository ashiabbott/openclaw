import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { CronService, type CronServiceDeps } from "./service.js";

const noopLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

async function makeStorePath() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-cron-bg-"));
  return {
    storePath: path.join(dir, "cron", "jobs.json"),
    cleanup: async () => {
      await fs.rm(dir, { recursive: true, force: true });
    },
  };
}

async function withCronService(
  params: {
    runIsolatedAgentJob?: CronServiceDeps["runIsolatedAgentJob"];
  },
  run: (context: { cron: CronService }) => Promise<void>,
) {
  const store = await makeStorePath();
  const cron = new CronService({
    cronEnabled: true,
    storePath: store.storePath,
    log: noopLogger,
    enqueueSystemEvent: vi.fn(),
    requestHeartbeatNow: vi.fn(),
    runIsolatedAgentJob:
      params.runIsolatedAgentJob ??
      (vi.fn(async () => ({ status: "ok" as const, summary: "done" })) as never),
  });

  await cron.start();
  try {
    await run({ cron });
  } finally {
    cron.stop();
    await store.cleanup();
  }
}

describe("cron run background mode", () => {
  it("returns immediately in background mode without waiting for job execution", async () => {
    // Simulate a slow agentTurn job that takes a long time.
    let resolveJob!: () => void;
    const jobPromise = new Promise<void>((r) => {
      resolveJob = r;
    });
    const runIsolatedAgentJob = vi.fn(async () => {
      await jobPromise;
      return { status: "ok" as const, summary: "done" };
    }) as unknown as CronServiceDeps["runIsolatedAgentJob"];

    await withCronService({ runIsolatedAgentJob }, async ({ cron }) => {
      const addResult = await cron.add({
        name: "slow-job",
        schedule: { kind: "every", everyMs: 86400000 },
        sessionTarget: "isolated",
        payload: { kind: "agentTurn", message: "do slow work" },
      });
      const jobId = addResult.id;

      // Background mode: run() should resolve immediately.
      const result = await cron.run(jobId, "force", { background: true });
      expect(result).toEqual({ ok: true, ran: true });

      // The isolated agent job should have been called but not yet resolved.
      expect(runIsolatedAgentJob).toHaveBeenCalledTimes(1);

      // Let the background job complete.
      resolveJob();

      // Give the background promise a tick to settle.
      await new Promise<void>((r) => setTimeout(r, 50));
    });
  });

  it("blocks when background is not set (default behavior)", async () => {
    const executionOrder: string[] = [];
    const runIsolatedAgentJob = vi.fn(async () => {
      executionOrder.push("job-executed");
      return { status: "ok" as const, summary: "done" };
    }) as unknown as CronServiceDeps["runIsolatedAgentJob"];

    await withCronService({ runIsolatedAgentJob }, async ({ cron }) => {
      const addResult = await cron.add({
        name: "fast-job",
        schedule: { kind: "every", everyMs: 86400000 },
        sessionTarget: "isolated",
        payload: { kind: "agentTurn", message: "do work" },
      });

      // Default (no background opt): run() should block until job completes.
      await cron.run(addResult.id, "force");
      executionOrder.push("run-returned");

      // Job must have executed before run returned.
      expect(executionOrder).toEqual(["job-executed", "run-returned"]);
    });
  });
});
