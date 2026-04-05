import { describe, expect, it } from "vitest";
import twilio from "twilio";
import { handleInboundSms } from "./handler.js";
import type { Job, JobEvent, SmsCommand } from "@twilio-pi-agent/shared";

function makeConfig() {
  return {
    UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
    UPSTASH_REDIS_REST_TOKEN: "token",
    ALLOWED_SMS_FROM: "+15555555555,+15109355552",
    WORKSPACE_ROOT: "/tmp/workspace",
    OLLAMA_BASE_URL: "http://127.0.0.1:11434/v1",
    PI_MODEL_PROVIDER: "openai",
    PI_MODEL_ID: "gemma4:31b",
    CODEX_BIN: "codex",
    JOB_QUEUE_KEY: "jobs",
    JOB_KEY_PREFIX: "job:",
    EVENT_KEY_PREFIX: "events:",
    LATEST_JOB_KEY_PREFIX: "latest:",
    CURRENT_JOB_KEY_PREFIX: "current:",
    SENDER_JOBS_KEY_PREFIX: "sender-jobs:",
    NEXT_JOB_NUMBER_KEY_PREFIX: "job-counter:",
    RUNNER_CONCURRENCY: 2,
    PI_PROMPT_TIMEOUT_MS: 300000,
    TWILIO_ACCOUNT_SID: "sid",
    TWILIO_AUTH_TOKEN: "auth",
    TWILIO_PHONE_NUMBER: "+15550000000",
    TWILIO_WEBHOOK_AUTH_TOKEN: "auth"
  };
}

function sign(url: string, body: Record<string, string>) {
  return twilio.getExpectedTwilioSignature("auth", url, body);
}

class FakeStore {
  jobs = new Map<string, Job>();
  events = new Map<string, JobEvent[]>();

  currentJobId: string | null = null;
  nextJobNumber = 1;

  async enqueuePrompt(input: { sender: string; command: SmsCommand; correlationId: string }) {
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
      source: "sms",
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
      return this.currentJobId ?? "job-12345678";
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
    const latest = this.jobs.get("job-12345678");
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

describe("handleInboundSms", () => {
  it("rejects unauthorized senders", async () => {
    const url = "https://example.com/twilio";
    const body = { From: "+15559999999", Body: "run hello" };
    const result = await handleInboundSms(
      { url, body, headers: { "X-Twilio-Signature": sign(url, body) } },
      { config: makeConfig() }
    );

    expect(result).toContain("Unauthorized.");
  });

  it("returns help text for /help", async () => {
    const url = "https://example.com/twilio";
    const body = { From: "+15555555555", Body: "/help" };
    const result = await handleInboundSms(
      { url, body, headers: { "X-Twilio-Signature": sign(url, body) } },
      { config: makeConfig(), store: new FakeStore() as never }
    );

    expect(result).toContain("Plain text goes to the current job.");
    expect(result).toContain("/jobs [jobNumber]");
    expect(result).toContain("/run &lt;task&gt;  start a new job");
  });

  it("queues plain text into a job", async () => {
    const url = "https://example.com/twilio";
    const body = { From: "+15555555555", Body: "inspect this repo" };
    const store = new FakeStore();
    const result = await handleInboundSms(
      { url, body, headers: { "X-Twilio-Signature": sign(url, body) } },
      { config: makeConfig(), store: store as never }
    );

    expect(result).toContain("Queued for job #");
    expect(store.jobs.size).toBe(1);
  });

  it("starts a new job for /run even when a current job exists", async () => {
    const url = "https://example.com/twilio";
    const store = new FakeStore();
    await store.enqueuePrompt({
      sender: "+15555555555",
      command: { type: "run", rawText: "first task", task: "first task", newJob: false },
      correlationId: "sms_seed"
    });

    const body = { From: "+15555555555", Body: "/run second task" };
    const result = await handleInboundSms(
      { url, body, headers: { "X-Twilio-Signature": sign(url, body) } },
      { config: makeConfig(), store: store as never }
    );

    expect(result).toContain("Queued for job #2.");
    expect(store.jobs.size).toBe(2);
    expect(store.currentJobId).toBe("job-00000002");
  });

  it("confirms dangerous jobs", async () => {
    const url = "https://example.com/twilio";
    const store = new FakeStore();
    store.jobs.set("job-12345678", {
      jobId: "job-12345678",
      source: "sms",
      sender: "+15555555555",
      jobNumber: 1,
      command: { type: "run", rawText: "rm -rf tmp", task: "rm -rf tmp", newJob: false },
      status: "awaiting_confirmation",
      summary: "Awaiting confirmation",
      requiresConfirmation: true,
      confirmationToken: "abc123",
      confirmationRequestedAt: new Date().toISOString(),
      workspaceRoot: "/tmp/workspace",
      promptQueue: ["rm -rf tmp"],
      createdAt: new Date().toISOString(),
      correlationId: "sms_123"
    });
    store.currentJobId = "job-12345678";
    const body = { From: "+15555555555", Body: "/confirm abc123" };
    const result = await handleInboundSms(
      { url, body, headers: { "X-Twilio-Signature": sign(url, body) } },
      { config: makeConfig(), store: store as never }
    );

    expect(result).toContain("Confirmed job-1234");
  });

  it("lists recent jobs and switches current job by number", async () => {
    const url = "https://example.com/twilio";
    const store = new FakeStore();
    await store.enqueuePrompt({
      sender: "+15555555555",
      command: { type: "run", rawText: "first task", task: "first task", newJob: false },
      correlationId: "sms_1"
    });
    store.jobs.set("job-87654321", {
      jobId: "job-87654321",
      jobNumber: 2,
      source: "sms",
      sender: "+15555555555",
      command: { type: "run", rawText: "second task", task: "second task", newJob: false },
      status: "running",
      summary: "Working",
      requiresConfirmation: false,
      workspaceRoot: "/tmp/workspace",
      promptQueue: ["second task"],
      createdAt: new Date().toISOString(),
      correlationId: "sms_2"
    });

    const listBody = { From: "+15555555555", Body: "/jobs" };
    const listResult = await handleInboundSms(
      { url, body: listBody, headers: { "X-Twilio-Signature": sign(url, listBody) } },
      { config: makeConfig(), store: store as never }
    );
    expect(listResult).toContain("#1");
    expect(listResult).toContain("#2");

    const switchBody = { From: "+15555555555", Body: "/jobs 2" };
    const switchResult = await handleInboundSms(
      { url, body: switchBody, headers: { "X-Twilio-Signature": sign(url, switchBody) } },
      { config: makeConfig(), store: store as never }
    );
    expect(switchResult).toContain("Current job is now #2.");
    expect(store.currentJobId).toBe("job-87654321");
  });
});
