import { buildHelpText } from "./commands.js";
import { AgentCommand, Job, JobEvent } from "./types.js";

export function formatInboundAck(command: AgentCommand, job?: Job): string {
  if (command.type === "help") {
    return buildHelpText();
  }
  if (!job) {
    return "Accepted.";
  }
  if (job.status === "awaiting_confirmation" && job.confirmationToken) {
    return `Queued for job #${job.jobNumber}. Reply /confirm ${job.confirmationToken} to run it.`;
  }
  return command.type === "run"
    ? `Queued for job #${job.jobNumber}.`
    : `Accepted ${command.type} for job #${job.jobNumber}.`;
}

export function formatJobStatus(job: Job, events: JobEvent[]): string {
  const latest = events.at(-1);
  const suffix = latest ? ` Latest: ${latest.message}` : "";
  return `Job #${job.jobNumber} is ${job.status}.${suffix}`.trim();
}

export function formatLogResponse(job: Job, events: JobEvent[]): string {
  const lines = events
    .flatMap((event) => {
      const chunks = [event.stdoutChunk, event.stderrChunk].filter(Boolean) as string[];
      if (chunks.length > 0) {
        return chunks;
      }
      return [`[${event.phase}] ${event.message}`];
    })
    .slice(-5);

  if (lines.length === 0) {
    return `No logs yet for job #${job.jobNumber}.`;
  }

  return [`Logs for job #${job.jobNumber}:`, ...lines].join("\n");
}

export function formatJobsList(jobs: Job[], currentJobId: string | null): string {
  if (jobs.length === 0) {
    return "No jobs in the last 24 hours.";
  }

  return jobs
    .map((job) => `${job.jobId === currentJobId ? "*" : " "}#${job.jobNumber} ${job.status} ${job.summary}`.trim())
    .join("\n");
}
