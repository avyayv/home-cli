import { Redis } from "@upstash/redis";
import { randomUUID } from "node:crypto";
import { AppConfig } from "./config.js";
import { requiresConfirmation } from "./commands.js";
import { EnqueueCommand, Job, jobEventSchema, JobEvent, jobSchema } from "./types.js";

type TargetLookup = string;

export class ControlPlaneStore {
  private readonly redis: Redis;
  private readonly cfg: AppConfig;

  constructor(cfg: AppConfig) {
    this.cfg = cfg;
    this.redis = new Redis({
      url: cfg.UPSTASH_REDIS_REST_URL,
      token: cfg.UPSTASH_REDIS_REST_TOKEN
    });
  }

  private jobKey(jobId: string): string {
    return `${this.cfg.JOB_KEY_PREFIX}${jobId}`;
  }

  private eventKey(jobId: string): string {
    return `${this.cfg.EVENT_KEY_PREFIX}${jobId}`;
  }

  private latestJobKey(sender: string): string {
    return `${this.cfg.LATEST_JOB_KEY_PREFIX}${sender}`;
  }

  private currentJobKey(sender: string): string {
    return `${this.cfg.CURRENT_JOB_KEY_PREFIX}${sender}`;
  }

  private senderJobsKey(sender: string): string {
    return `${this.cfg.SENDER_JOBS_KEY_PREFIX}${sender}`;
  }

  private nextJobNumberKey(sender: string): string {
    return `${this.cfg.NEXT_JOB_NUMBER_KEY_PREFIX}${sender}`;
  }

  async enqueuePrompt(payload: EnqueueCommand): Promise<Job> {
    if (payload.command.type !== "run") {
      return this.enqueueStandaloneCommand(payload);
    }

    const sender = payload.sender;
    const currentJobId = await this.getCurrentJobId(sender);
    const currentJob = currentJobId ? await this.getJob(currentJobId) : null;

    if (currentJob && !payload.command.newJob) {
      currentJob.promptQueue.push(payload.command.task);
      currentJob.command = payload.command;
      currentJob.summary = currentJob.status === "running" ? "Queued follow-up prompt" : "Queued";
      currentJob.finishedAt = undefined;

      if (currentJob.status !== "running" && currentJob.status !== "queued" && currentJob.status !== "awaiting_confirmation") {
        currentJob.status = "queued";
        await this.redis.rpush(this.cfg.JOB_QUEUE_KEY, currentJob.jobId);
      }

      await this.saveJob(currentJob);
      await this.appendEvent(currentJob.jobId, {
        eventId: randomUUID(),
        jobId: currentJob.jobId,
        timestamp: new Date().toISOString(),
        phase: "queue",
        kind: "queued",
        message: `Prompt queued for job #${currentJob.jobNumber}`,
        details: { prompt: payload.command.task }
      });
      return currentJob;
    }

    return this.createJob(payload, payload.command.task);
  }

  private async enqueueStandaloneCommand(payload: EnqueueCommand): Promise<Job> {
    return this.createJob(payload, "");
  }

  private async createJob(payload: EnqueueCommand, initialPrompt: string): Promise<Job> {
    const now = new Date().toISOString();
    const jobId = randomUUID();
    const sender = payload.sender;
    const nextNumber = await this.redis.incr(this.nextJobNumberKey(sender));
    const dangerous = payload.command.type === "run" ? requiresConfirmation(payload.command.task) : false;
    const confirmationToken = dangerous ? randomUUID().slice(0, 6) : undefined;

    const job = jobSchema.parse({
      jobId,
      jobNumber: nextNumber,
      source: "imessage",
      sender,
      command: payload.command,
      status: dangerous ? "awaiting_confirmation" : "queued",
      summary: dangerous ? "Awaiting confirmation" : "Queued",
      requiresConfirmation: dangerous,
      confirmationToken,
      confirmationRequestedAt: dangerous ? now : undefined,
      workspaceRoot: this.cfg.WORKSPACE_ROOT,
      promptQueue: initialPrompt ? [initialPrompt] : [],
      createdAt: now,
      correlationId: payload.correlationId
    });

    await this.redis.set(this.jobKey(jobId), job);
    await this.redis.set(this.latestJobKey(sender), jobId);
    await this.redis.set(this.currentJobKey(sender), jobId);
    await this.redis.lpush(this.senderJobsKey(sender), jobId);
    await this.redis.ltrim(this.senderJobsKey(sender), 0, 49);

    if (!dangerous) {
      await this.redis.rpush(this.cfg.JOB_QUEUE_KEY, jobId);
    }
    await this.appendEvent(jobId, {
      eventId: randomUUID(),
      jobId,
      timestamp: now,
      phase: dangerous ? "confirmation" : "queue",
      kind: dangerous ? "waiting_confirmation" : "queued",
      message: dangerous ? `Job #${job.jobNumber} awaiting confirmation` : `Job #${job.jobNumber} queued`,
      details: { commandType: payload.command.type, confirmationToken }
    });

    return job;
  }

  async dequeueJob(): Promise<Job | null> {
    const jobId = await this.redis.lpop<string | null>(this.cfg.JOB_QUEUE_KEY);
    if (!jobId) {
      return null;
    }
    return this.getJob(jobId);
  }

  async getJob(jobId: string): Promise<Job | null> {
    const job = await this.redis.get(this.jobKey(jobId));
    if (!job) {
      return null;
    }
    try {
      const parsed = typeof job === "string" ? JSON.parse(job) : job;
      return jobSchema.parse(parsed);
    } catch {
      return null;
    }
  }

  async getCurrentJobId(sender: string): Promise<string | null> {
    return (await this.redis.get<string | null>(this.currentJobKey(sender))) ?? null;
  }

  async setCurrentJob(sender: string, jobId: string): Promise<Job | null> {
    const job = await this.getJob(jobId);
    if (!job || job.sender !== sender) {
      return null;
    }
    await this.redis.set(this.currentJobKey(sender), jobId);
    await this.redis.set(this.latestJobKey(sender), jobId);
    return job;
  }

  async listRecentJobs(sender: string, hours = 24, limit = 10): Promise<Job[]> {
    const ids = await this.redis.lrange<string>(this.senderJobsKey(sender), 0, Math.max(20, limit * 3));
    const jobs: Job[] = [];
    const cutoff = Date.now() - hours * 60 * 60 * 1000;

    for (const id of ids) {
      const job = await this.getJob(id);
      if (!job) {
        continue;
      }
      if (new Date(job.createdAt).getTime() < cutoff) {
        continue;
      }
      jobs.push(job);
      if (jobs.length >= limit) {
        break;
      }
    }

    return jobs;
  }

  async resolveJobId(sender: string, target: TargetLookup): Promise<string | null> {
    if (target === "latest") {
      return (await this.redis.get<string | null>(this.latestJobKey(sender))) ?? null;
    }

    if (/^\d+$/.test(target)) {
      const jobs = await this.listRecentJobs(sender, 24, 50);
      const number = Number.parseInt(target, 10);
      return jobs.find((job) => job.jobNumber === number)?.jobId ?? null;
    }

    return target;
  }

  async saveJob(job: Job): Promise<void> {
    await this.redis.set(this.jobKey(job.jobId), jobSchema.parse(job));
    await this.redis.set(this.latestJobKey(job.sender), job.jobId);
  }

  async confirmJob(sender: string, token: string): Promise<Job | null> {
    const currentJobId = await this.getCurrentJobId(sender);
    if (!currentJobId) {
      return null;
    }
    const job = await this.getJob(currentJobId);
    if (!job || !job.requiresConfirmation || job.confirmationToken !== token || job.status !== "awaiting_confirmation") {
      return null;
    }

    job.status = "queued";
    job.summary = "Confirmed and queued";
    job.requiresConfirmation = false;
    job.confirmationRequestedAt = undefined;
    job.confirmationToken = undefined;
    await this.saveJob(job);
    await this.redis.rpush(this.cfg.JOB_QUEUE_KEY, job.jobId);
    await this.appendEvent(job.jobId, {
      eventId: randomUUID(),
      jobId: job.jobId,
      timestamp: new Date().toISOString(),
      phase: "confirmation",
      kind: "queued",
      message: `Confirmation received; job #${job.jobNumber} queued`,
      details: {}
    });
    return job;
  }

  async appendEvent(jobId: string, event: JobEvent): Promise<void> {
    const parsed = jobEventSchema.parse(event);
    await this.redis.rpush(this.eventKey(jobId), parsed);
  }

  async getEvents(jobId: string, limit = 25): Promise<JobEvent[]> {
    const raw = await this.redis.lrange<unknown[]>(this.eventKey(jobId), -Math.max(limit, 1), -1);
    return raw.flatMap((item) => parseEventRecords(item));
  }
}

function parseEventRecords(value: unknown): JobEvent[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => parseEventRecords(item));
  }

  const parsed = typeof value === "string" ? tryParseJson(value) : value;
  if (Array.isArray(parsed)) {
    return parsed.flatMap((item) => parseEventRecords(item));
  }

  if (!parsed || typeof parsed !== "object") {
    return [];
  }

  const result = jobEventSchema.safeParse(parsed);
  return result.success ? [result.data] : [];
}

export const __test_parseEventRecords = parseEventRecords;

function tryParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
