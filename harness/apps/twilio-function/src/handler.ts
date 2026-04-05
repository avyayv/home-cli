import { randomUUID } from "node:crypto";
import { URLSearchParams } from "node:url";
import twilio from "twilio";
import {
  buildHelpText,
  ControlPlaneStore,
  createCorrelationId,
  formatInboundAck,
  formatJobsList,
  formatJobStatus,
  formatLogResponse,
  getAllowedSmsSenders,
  loadConfig,
  parseSmsCommand
} from "@twilio-pi-agent/shared";

export type InboundRequest = {
  url: string;
  headers: Record<string, string | undefined>;
  body: Record<string, string | undefined>;
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

export async function handleInboundSms(input: InboundRequest, deps?: { config?: ReturnType<typeof loadConfig>; store?: StoreLike }): Promise<string> {
  const cfg = deps?.config ?? loadConfig();
  const signature = input.headers["x-twilio-signature"] ?? input.headers["X-Twilio-Signature"];
  const authToken = cfg.TWILIO_WEBHOOK_AUTH_TOKEN ?? cfg.TWILIO_AUTH_TOKEN;

  if (!authToken || !signature) {
    throw new Error("Twilio webhook validation is not configured.");
  }

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input.body)) {
    if (value !== undefined) {
      params.append(key, value);
    }
  }

  const isValid = twilio.validateRequest(authToken, signature, input.url, Object.fromEntries(params));
  if (!isValid) {
    throw new Error("Twilio signature validation failed.");
  }

  const from = input.body.From?.trim();
  const text = input.body.Body?.trim() ?? "";
  const allowedSenders = getAllowedSmsSenders(cfg);
  if (!from || !allowedSenders.includes(from)) {
    return twiml("Unauthorized.");
  }

  const command = parseSmsCommand(text);
  const store = deps?.store ?? new ControlPlaneStore(cfg);

  switch (command.type) {
    case "help":
      return twiml(buildHelpText());
    case "jobs": {
      if (command.target) {
        const jobId = await store.resolveJobId(from, command.target);
        if (!jobId) {
          return twiml("No job found.");
        }
        const job = await store.setCurrentJob(from, jobId);
        if (!job) {
          return twiml("No job found.");
        }
        return twiml(`Current job is now #${job.jobNumber}.`);
      }
      const jobs = await store.listRecentJobs(from, 24, 8);
      const currentJobId = await store.getCurrentJobId(from);
      return twiml(formatJobsList(jobs, currentJobId));
    }
    case "status": {
      const jobId = await store.resolveJobId(from, command.target);
      if (!jobId) {
        return twiml("No job found.");
      }
      const job = await store.getJob(jobId);
      if (!job) {
        return twiml("No job found.");
      }
      const events = await store.getEvents(jobId, 10);
      return twiml(formatJobStatus(job, events));
    }
    case "logs": {
      const jobId = await store.resolveJobId(from, command.target);
      if (!jobId) {
        return twiml("No job found.");
      }
      const job = await store.getJob(jobId);
      if (!job) {
        return twiml("No job found.");
      }
      const events = await store.getEvents(jobId, command.lines);
      return twiml(formatLogResponse(job, events));
    }
    case "abort": {
      const jobId = await store.resolveJobId(from, command.target);
      if (!jobId) {
        return twiml("No job found.");
      }
      const job = await store.getJob(jobId);
      if (!job) {
        return twiml("No job found.");
      }
      job.status = "aborted";
      job.summary = "Aborted by SMS command.";
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
      return twiml(`Aborted ${job.jobId.slice(0, 8)}.`);
    }
    case "confirm":
    {
      const job = await store.confirmJob(from, command.token);
      if (!job) {
        return twiml("No pending job matched that token.");
      }
      return twiml(`Confirmed ${job.jobId.slice(0, 8)}. Job queued.`);
    }
    case "run": {
      const job = await store.enqueuePrompt({
        sender: from,
        command,
        receivedAt: new Date().toISOString(),
        correlationId: createCorrelationId("sms")
      });
      return twiml(formatInboundAck(command, job));
    }
  }
}

function twiml(message: string): string {
  const response = new twilio.twiml.MessagingResponse();
  response.message(message);
  return response.toString();
}
