import { randomUUID } from "node:crypto";
import {
  buildHelpText,
  collectEventLogLines,
  ControlPlaneStore,
  createCorrelationId,
  formatJobsList,
  formatJobStatus,
  formatLogResponse,
  getAllowedIMessageHandles,
  Job,
  JobEvent,
  loadConfig,
  parseAgentCommand
} from "@imessage-pi-agent/shared";

export type InboundMessage = {
  from: string;
  text: string;
};

export type InboundReply =
  | {
      mode: "reply";
      message: string;
    }
  | {
      mode: "stream";
      job: Job;
      intervalMs: number;
      startMessage: string;
    };

type StoreLike = Pick<
  ControlPlaneStore,
  | "enqueuePrompt"
  | "resolveJobId"
  | "getJob"
  | "getEvents"
  | "saveJob"
  | "appendEvent"
  | "confirmJob"
  | "setCurrentJob"
  | "listRecentJobs"
  | "getCurrentJobId"
>;

export async function handleInboundIMessage(
  input: InboundMessage,
  deps?: { config?: ReturnType<typeof loadConfig>; store?: StoreLike; sleep?: (ms: number) => Promise<void> }
): Promise<InboundReply> {
  const cfg = deps?.config ?? loadConfig();
  const from = input.from.trim();
  const text = input.text.trim();
  const allowedHandles = getAllowedIMessageHandles(cfg);

  if (!allowedHandles.includes(from)) {
    return { mode: "reply", message: "Unauthorized." };
  }

  const command = parseAgentCommand(text);
  const store = deps?.store ?? new ControlPlaneStore(cfg);
  const sleep = deps?.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));

  switch (command.type) {
    case "help":
      return { mode: "reply", message: buildHelpText() };
    case "jobs": {
      if (command.target) {
        const jobId = await store.resolveJobId(from, command.target);
        if (!jobId) {
          return { mode: "reply", message: "No job found." };
        }
        const job = await store.setCurrentJob(from, jobId);
        if (!job) {
          return { mode: "reply", message: "No job found." };
        }
        return { mode: "reply", message: `Current job is now #${job.jobNumber}.` };
      }
      const jobs = await store.listRecentJobs(from, 24, 8);
      const currentJobId = await store.getCurrentJobId(from);
      return { mode: "reply", message: formatJobsList(jobs, currentJobId) };
    }
    case "status": {
      const jobId = await store.resolveJobId(from, command.target);
      if (!jobId) {
        return { mode: "reply", message: "No job found." };
      }
      const job = await store.getJob(jobId);
      if (!job) {
        return { mode: "reply", message: "No job found." };
      }
      const events = await store.getEvents(jobId, 10);
      return { mode: "reply", message: formatJobStatus(job, events) };
    }
    case "logs": {
      const jobId = await store.resolveJobId(from, command.target);
      if (!jobId) {
        return { mode: "reply", message: "No job found." };
      }
      const job = await store.getJob(jobId);
      if (!job) {
        return { mode: "reply", message: "No job found." };
      }
      const events = await store.getEvents(jobId, command.lines);
      return { mode: "reply", message: formatLogResponse(job, events) };
    }
    case "abort": {
      const jobId = await store.resolveJobId(from, command.target);
      if (!jobId) {
        return { mode: "reply", message: "No job found." };
      }
      const job = await store.getJob(jobId);
      if (!job) {
        return { mode: "reply", message: "No job found." };
      }
      job.status = "aborted";
      job.summary = "Aborted by iMessage command.";
      job.finishedAt = new Date().toISOString();
      await store.saveJob(job);
      await store.appendEvent(jobId, {
        eventId: randomUUID(),
        jobId,
        timestamp: new Date().toISOString(),
        phase: "completion",
        kind: "aborted",
        message: "Job aborted by user",
        details: {}
      });
      return { mode: "reply", message: `Aborted ${job.jobId.slice(0, 8)}.` };
    }
    case "confirm": {
      const job = await store.confirmJob(from, command.token);
      if (!job) {
        return { mode: "reply", message: "No pending job matched that token." };
      }
      return { mode: "reply", message: `Confirmed ${job.jobId.slice(0, 8)}. Job queued.` };
    }
    case "run": {
      const job = await store.enqueuePrompt({
        sender: from,
        command,
        receivedAt: new Date().toISOString(),
        correlationId: createCorrelationId("imessage")
      });
      if (job.status === "awaiting_confirmation" && job.confirmationToken) {
        return {
          mode: "reply",
          message: `Job #${job.jobNumber} is waiting for confirmation. Reply /confirm ${job.confirmationToken} to run it.`
        };
      }
      if (command.loggingEnabled) {
        const intervalMs = Math.max(1, command.loggingIntervalSeconds ?? 0) * 1000 || cfg.IMESSAGE_LOG_INTERVAL_MS;
        return {
          mode: "stream",
          job,
          intervalMs,
          startMessage: `Streaming logs for job #${job.jobNumber} every ${Math.round(intervalMs / 1000)}s.`
        };
      }
      return {
        mode: "reply",
        message: await waitForJobReply(job, store, cfg, sleep)
      };
    }
  }
}

async function waitForJobReply(
  job: Job,
  store: Pick<StoreLike, "getJob" | "getEvents">,
  cfg: ReturnType<typeof loadConfig>,
  sleep: (ms: number) => Promise<void>
): Promise<string> {
  const deadline = Date.now() + cfg.IMESSAGE_SYNC_TIMEOUT_MS;

  for (;;) {
    const current = await store.getJob(job.jobId);
    if (!current) {
      return "The job disappeared before I could return a result.";
    }

    if (current.status === "completed") {
      return current.summary?.trim() || `Job #${current.jobNumber} completed.`;
    }

    if (current.status === "failed") {
      const events = await store.getEvents(current.jobId, 10);
      const latest = events.at(-1)?.message ?? current.summary;
      return `Job #${current.jobNumber} failed: ${latest}`;
    }

    if (current.status === "aborted") {
      return `Job #${current.jobNumber} was aborted.`;
    }

    if (Date.now() >= deadline) {
      return `Still working on job #${current.jobNumber}. Reply /status for progress.`;
    }

    await sleep(cfg.IMESSAGE_SYNC_POLL_MS);
  }
}

export function formatIncrementalLogUpdate(job: Job, events: JobEvent[], linesPerUpdate: number): string {
  const lines = collectEventLogLines(events)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-Math.max(1, linesPerUpdate));

  if (lines.length === 0) {
    return "";
  }

  return [`Job #${job.jobNumber} update:`, ...lines].join("\n");
}
