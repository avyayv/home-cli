import { describe, expect, it } from "vitest";
import { handleInboundIMessage } from "./handler.js";
import type { AgentCommand, Job, JobEvent } from "@imessage-pi-agent/shared";

function makeConfig() {
  return {
    UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
    UPSTASH_REDIS_REST_TOKEN: "token",
    ALLOWED_IMESSAGE_HANDLES: "+15109355552,+15555555555",
    WORKSPACE_ROOT: "/tmp/workspace",
    OLLAMA_BASE_URL: "http://127.0.0.1:11434/v1",
    PI_MODEL_PROVIDER: "openai",
    PI_MODEL_ID: "gemma4:31b",
    CODEX_BIN: "codex",
    IMESSAGE_POLL_INTERVAL_MS: 4000,
    IMESSAGE_SYNC_TIMEOUT_MS: 200,
    IMESSAGE_SYNC_POLL_MS: 1,
    JOB_QUEUE_KEY: "jobs",
    JOB_KEY_PREFIX: "job:",
    EVENT_KEY_PREFIX: "events:",
    LATEST_JOB_KEY_PREFIX: "latest:",
    CURRENT_JOB_KEY_PREFIX: "current:",
    SENDER_JOBS_KEY_PREFIX: "sender-jobs:",
    NEXT_JOB_NUMBER_KEY_PREFIX: "job-counter:",
    RUNNER_CONCURRENCY: 2,
    PI_PROMPT_TIMEOUT_MS: 300000
  };
}

class FakeStore {
  jobs = new Map<string, Job>();
  events = new Map<string, JobEvent[]>();
  currentJobId: string | null = null;
  nextJobNumber = 1;

  async enqueuePrompt(input: { sender: string; command: AgentCommand; correlationId: string }) {
    const currentJob = this.currentJobId ? this.jobs.get(this.currentJobId) ?? null : null;
    if (input.command.type === "run" && currentJob && !input.command.newJob) {
      currentJob.command = input.command;
      currentJob.promptQueue.push(input.command.task);
      currentJob.summary = "Queued";
      this.jobs.set(currentJob.jobId, currentJob);
      return currentJob;
    }

    const jobId = `job-${String(this.nextJobNumber).padStart(8, "0")}`;
    const job: Job = {
      jobId,
      jobNumber: this.nextJobNumber,
      source: "imessage",
      sender: input.sender,
      command: input.command,
      status: "queued",
      summary: "Queued",
      requiresConfirmation: false,
      workspaceRoot: "/tmp/workspace",
      promptQueue: input.command.type === "run" ? [input.command.task] : [],
      createdAt: new Date().toISOString(),
      correlationId: input.correlationId
    };
    this.nextJobNumber += 1;
    this.jobs.set(job.jobId, job);
    this.events.set(job.jobId, []);
    this.currentJobId = job.jobId;
    return job;
  }

  async resolveJobId(_sender: string, target: string) {
    if (target === "latest") {
      return this.currentJobId ?? null;
    }
    if (/^\d+$/.test(target)) {
      const number = Number.parseInt(target, 10);
      return [...this.jobs.values()].find((job) => job.jobNumber === number)?.jobId ?? null;
    }
    return target;
  }

  async getJob(jobId: string) {
    return this.jobs.get(jobId) ?? null;
  }

  async getEvents(jobId: string) {
    return this.events.get(jobId) ?? [];
  }

  async saveJob(job: Job) {
    this.jobs.set(job.jobId, job);
  }

  async appendEvent(jobId: string, event: JobEvent) {
    this.events.set(jobId, [...(this.events.get(jobId) ?? []), event]);
  }

  async confirmJob(sender: string, token: string) {
    const latest = this.currentJobId ? this.jobs.get(this.currentJobId) ?? null : null;
    if (!latest || latest.sender !== sender || latest.confirmationToken !== token) {
      return null;
    }
    latest.status = "queued";
    latest.requiresConfirmation = false;
    latest.confirmationToken = undefined;
    this.jobs.set(latest.jobId, latest);
    return latest;
  }

  async setCurrentJob(_sender: string, jobId: string) {
    const job = this.jobs.get(jobId) ?? null;
    if (job) {
      this.currentJobId = jobId;
    }
    return job;
  }

  async getCurrentJobId() {
    return this.currentJobId;
  }

  async listRecentJobs() {
    return [...this.jobs.values()];
  }
}

describe("handleInboundIMessage", () => {
  it("rejects unauthorized handles", async () => {
    const result = await handleInboundIMessage({ from: "+19999999999", text: "run hello" }, { config: makeConfig() });
    expect(result).toBe("Unauthorized.");
  });

  it("returns help for /help", async () => {
    const result = await handleInboundIMessage(
      { from: "+15109355552", text: "/help" },
      { config: makeConfig(), store: new FakeStore() as never }
    );
    expect(result).toContain("Plain text goes to the current job.");
  });

  it("queues plain text into the current job model", async () => {
    const store = new FakeStore();
    const originalEnqueue = store.enqueuePrompt.bind(store);
    store.enqueuePrompt = async (input) => {
      const job = await originalEnqueue(input);
      job.status = "completed";
      job.summary = "Finished the task.";
      store.jobs.set(job.jobId, job);
      return job;
    };
    const result = await handleInboundIMessage(
      { from: "+15109355552", text: "inspect this repo" },
      { config: makeConfig(), store: store as never, sleep: async () => {} }
    );
    expect(result).toBe("Finished the task.");
    expect(store.jobs.size).toBe(1);
  });

  it("returns failures after synchronous waiting", async () => {
    const store = new FakeStore();
    const originalEnqueue = store.enqueuePrompt.bind(store);
    store.enqueuePrompt = async (input) => {
      const job = await originalEnqueue(input);
      job.status = "failed";
      job.summary = "boom";
      store.jobs.set(job.jobId, job);
      return job;
    };

    const result = await handleInboundIMessage(
      { from: "+15109355552", text: "do a thing" },
      { config: makeConfig(), store: store as never, sleep: async () => {} }
    );
    expect(result).toBe("Job #1 failed: boom");
  });

  it("falls back to a progress message when the job takes too long", async () => {
    const store = new FakeStore();
    const sleep = async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    };

    const result = await handleInboundIMessage(
      { from: "+15109355552", text: "long task" },
      { config: makeConfig(), store: store as never, sleep }
    );
    expect(result).toBe("Still working on job #1. Reply /status for progress.");
  });

  it("switches current job by /jobs number", async () => {
    const store = new FakeStore();
    await store.enqueuePrompt({
      sender: "+15109355552",
      command: { type: "run", rawText: "first", task: "first", newJob: false },
      correlationId: "seed"
    });
    store.jobs.set("job-00000002", {
      jobId: "job-00000002",
      jobNumber: 2,
      source: "imessage",
      sender: "+15109355552",
      command: { type: "run", rawText: "/run second", task: "second", newJob: true },
      status: "running",
      summary: "Working",
      requiresConfirmation: false,
      workspaceRoot: "/tmp/workspace",
      promptQueue: [],
      createdAt: new Date().toISOString(),
      correlationId: "seed_2"
    });

    const result = await handleInboundIMessage(
      { from: "+15109355552", text: "/jobs 2" },
      { config: makeConfig(), store: store as never }
    );
    expect(result).toContain("Current job is now #2.");
  });
});
