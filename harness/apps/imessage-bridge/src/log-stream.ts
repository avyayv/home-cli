import type { ControlPlaneStore, Job, JobEvent, loadConfig } from "@imessage-pi-agent/shared";
import { formatSingleEventUpdate } from "./handler.js";
import { sendIMessage } from "./imessage.js";

const STREAM_CHUNK_FLUSH_CHARS = 240;

type EventBuffer = {
  stdout: string;
  stderr: string;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function streamJobLogs(
  recipient: string,
  jobId: string,
  store: ControlPlaneStore,
  config: ReturnType<typeof loadConfig>,
  serviceId: string
): Promise<void> {
  const seenEventIds = new Set<string>();
  const buffer: EventBuffer = { stdout: "", stderr: "" };

  for (;;) {
    const job = await store.getJob(jobId);
    if (!job) {
      await sendIMessage(recipient, "The job disappeared before I could stream logs.", serviceId);
      return;
    }

    const events = await store.getEvents(jobId, 200);
    const unseenEvents = events.filter((event) => !seenEventIds.has(event.eventId));
    for (const event of unseenEvents) {
      seenEventIds.add(event.eventId);
      if (isChunkOnlyEvent(event)) {
        const maybeUpdate = appendChunkAndMaybeFormat(job, buffer, event);
        if (maybeUpdate) {
          await sendIMessage(recipient, maybeUpdate, serviceId);
        }
        continue;
      }

      const buffered = flushBufferedChunks(job, buffer);
      if (buffered) {
        await sendIMessage(recipient, buffered, serviceId);
      }

      const update = formatSingleEventUpdate(job, event);
      if (update) {
        await sendIMessage(recipient, update, serviceId);
      }
    }

    if (job.status === "completed") {
      const buffered = flushBufferedChunks(job, buffer);
      if (buffered) {
        await sendIMessage(recipient, buffered, serviceId);
      }
      await sendIMessage(recipient, job.summary?.trim() || `Job #${job.jobNumber} completed.`, serviceId);
      return;
    }

    if (job.status === "failed") {
      const buffered = flushBufferedChunks(job, buffer);
      if (buffered) {
        await sendIMessage(recipient, buffered, serviceId);
      }
      await sendIMessage(recipient, `Job #${job.jobNumber} failed: ${job.summary || "Unknown error."}`, serviceId);
      return;
    }

    if (job.status === "aborted") {
      const buffered = flushBufferedChunks(job, buffer);
      if (buffered) {
        await sendIMessage(recipient, buffered, serviceId);
      }
      await sendIMessage(recipient, `Job #${job.jobNumber} was aborted.`, serviceId);
      return;
    }

    await sleep(config.IMESSAGE_SYNC_POLL_MS);
  }
}

function isChunkOnlyEvent(event: JobEvent): boolean {
  const hasChunk = Boolean(event.stdoutChunk || event.stderrChunk);
  if (!hasChunk) {
    return false;
  }

  const structuralKinds = new Set(["tool_start", "tool_end", "completed", "failed", "aborted", "queued", "started"]);
  return !structuralKinds.has(event.kind);
}

function appendChunkAndMaybeFormat(job: Pick<Job, "jobNumber">, buffer: EventBuffer, event: JobEvent): string | null {
  if (event.stdoutChunk) {
    buffer.stdout += event.stdoutChunk;
    if (shouldFlushChunkBuffer(buffer.stdout)) {
      const text = buffer.stdout.trim();
      buffer.stdout = "";
      return text ? `Job #${job.jobNumber} update:\n${text}` : null;
    }
  }

  if (event.stderrChunk) {
    buffer.stderr += event.stderrChunk;
    if (shouldFlushChunkBuffer(buffer.stderr)) {
      const text = buffer.stderr.trim();
      buffer.stderr = "";
      return text ? `Job #${job.jobNumber} error:\n${text}` : null;
    }
  }

  return null;
}

function flushBufferedChunks(job: Pick<Job, "jobNumber">, buffer: EventBuffer): string | null {
  const parts: string[] = [];
  const stdout = buffer.stdout.trim();
  const stderr = buffer.stderr.trim();

  if (stdout) {
    parts.push(`Job #${job.jobNumber} update:\n${stdout}`);
  }
  if (stderr) {
    parts.push(`Job #${job.jobNumber} error:\n${stderr}`);
  }

  buffer.stdout = "";
  buffer.stderr = "";
  return parts.join("\n\n") || null;
}

function shouldFlushChunkBuffer(value: string): boolean {
  if (!value.trim()) {
    return false;
  }

  if (value.length >= STREAM_CHUNK_FLUSH_CHARS) {
    return true;
  }

  return /[\n.!?]$/.test(value);
}
