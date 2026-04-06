import "./env.js";
import { randomUUID } from "node:crypto";
import process from "node:process";
import { ControlPlaneStore, Job, loadConfig } from "@imessage-pi-agent/shared";
import { PiRunner } from "./pi-runner.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const homeBin = process.env.HOME ? `${process.env.HOME}/.local/bin` : undefined;

if (homeBin) {
  const pathEntries = (process.env.PATH ?? "").split(":").filter(Boolean);
  if (!pathEntries.includes(homeBin)) {
    process.env.PATH = [homeBin, ...pathEntries].join(":");
  }
}

async function runLoop(): Promise<void> {
  const cfg = loadConfig();
  const store = new ControlPlaneStore(cfg);
  const runner = new PiRunner(store, cfg.CODEX_BIN, cfg.PI_PROMPT_TIMEOUT_MS);
  await Promise.all(
    Array.from({ length: cfg.RUNNER_CONCURRENCY }, (_, index) => workerLoop(index + 1, store, runner))
  );
}

async function workerLoop(workerId: number, store: ControlPlaneStore, runner: PiRunner): Promise<void> {
  for (;;) {
    const job = await store.dequeueJob();
    if (!job) {
      await sleep(1500);
      continue;
    }
    await handleJob(job, store, runner, workerId);
  }
}

async function handleJob(job: Job, store: ControlPlaneStore, runner: PiRunner, workerId: number): Promise<void> {
  try {
    job.status = "running";
    job.startedAt = new Date().toISOString();
    job.activeExecutor = "pi";
    job.summary = "Runner started";
    await store.saveJob(job);
    await store.appendEvent(job.jobId, {
      eventId: randomUUID(),
      jobId: job.jobId,
      timestamp: new Date().toISOString(),
      phase: "runner",
      kind: "started",
      message: `Runner worker ${workerId} picked up job #${job.jobNumber}`,
      details: { workerId }
    });

    if (job.command.type !== "run") {
      job.status = "failed";
      job.finishedAt = new Date().toISOString();
      job.summary = `Unsupported queued command type: ${job.command.type}`;
      await store.saveJob(job);
      return;
    }

    while (job.promptQueue.length > 0) {
      const result = await runner.run(job);
      job.summary = result.summary;
      await store.saveJob(job);
      const refreshed = await store.getJob(job.jobId);
      if (!refreshed) {
        break;
      }
      job.promptQueue = refreshed.promptQueue;
    }

    job.status = "completed";
    job.finishedAt = new Date().toISOString();
    await store.saveJob(job);
    await store.appendEvent(job.jobId, {
      eventId: randomUUID(),
      jobId: job.jobId,
      timestamp: new Date().toISOString(),
      phase: "completion",
      kind: "completed",
      message: `Job #${job.jobNumber} completed`,
      details: { workerId }
    });
  } catch (error) {
    job.status = "failed";
    job.finishedAt = new Date().toISOString();
    job.summary = error instanceof Error ? error.message : "Unknown failure";
    await store.saveJob(job);
    await store.appendEvent(job.jobId, {
      eventId: randomUUID(),
      jobId: job.jobId,
      timestamp: new Date().toISOString(),
      phase: "error",
      kind: "failed",
      message: job.summary,
      details: {}
    });
  }
}

runLoop().catch((error) => {
  console.error(error);
  process.exit(1);
});
