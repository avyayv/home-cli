import "./env.js";
import { appendFile } from "node:fs/promises";
import {
  ControlPlaneStore,
  createCorrelationId,
  getAllowedIMessageHandles,
  loadConfig
} from "@imessage-pi-agent/shared";
import { formatIncrementalLogUpdate, handleInboundIMessage } from "./handler.js";
import {
  discoverIMessageServiceId,
  getBridgeStatePath,
  getLatestIncomingRowId,
  pollIncomingMessages,
  readBridgeState,
  resolveIMessageDbPath,
  sendIMessage,
  writeBridgeState
} from "./imessage.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function logBridgeError(message: string): Promise<void> {
  const logPath = process.env.IMESSAGE_BRIDGE_LOG_PATH ?? "/Users/avyay/Library/Logs/imessage-pi-agent-bridge.log";
  await appendFile(logPath, `${new Date().toISOString()} ${message}\n`, "utf8").catch(() => {});
}

async function runLoop(): Promise<void> {
  const config = loadConfig();
  const allowedHandles = getAllowedIMessageHandles(config);
  const statePath = getBridgeStatePath(config);
  const serviceId = config.IMESSAGE_SERVICE_ID ?? (await discoverIMessageServiceId());
  const store = new ControlPlaneStore(config);
  let state = await readBridgeState(statePath);

  for (;;) {
    try {
      const dbPath = await resolveIMessageDbPath(config);
      if (state.lastSeenRowId === 0) {
        state.lastSeenRowId = await getLatestIncomingRowId(dbPath, allowedHandles);
        await writeBridgeState(statePath, state);
      }
      const messages = await pollIncomingMessages(dbPath, allowedHandles, state.lastSeenRowId);
      for (const message of messages) {
        state.lastSeenRowId = Math.max(state.lastSeenRowId, message.rowId);
        const reply = await handleInboundIMessage(
          { from: message.from, text: message.text },
          { config, store }
        );
        if (reply.mode === "reply") {
          if (reply.message.trim()) {
            await sendIMessage(message.from, reply.message, serviceId);
          }
          continue;
        }
        if (reply.startMessage.trim()) {
          await sendIMessage(message.from, reply.startMessage, serviceId);
        }
        await streamJobLogs(message.from, reply.job.jobId, reply.intervalMs, store, config, serviceId);
      }
      await writeBridgeState(statePath, state);
    } catch (error) {
      const prefix = createCorrelationId("imessage_bridge");
      const detail = error instanceof Error ? error.message : String(error);
      console.error(`[${prefix}] ${detail}`);
      await logBridgeError(`[${prefix}] ${detail}`);
    }

    await sleep(config.IMESSAGE_POLL_INTERVAL_MS);
  }
}

async function streamJobLogs(
  recipient: string,
  jobId: string,
  intervalMs: number,
  store: ControlPlaneStore,
  config: ReturnType<typeof loadConfig>,
  serviceId: string
): Promise<void> {
  const seenEventIds = new Set<string>();
  let lastFlushAt = Date.now();

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
    }

    const shouldFlushLogs = unseenEvents.length > 0 && Date.now() - lastFlushAt >= intervalMs;
    if (shouldFlushLogs) {
      const update = formatIncrementalLogUpdate(job, unseenEvents, config.IMESSAGE_LOG_LINES_PER_UPDATE);
      if (update) {
        await sendIMessage(recipient, update, serviceId);
      }
      lastFlushAt = Date.now();
    }

    if (job.status === "completed") {
      const trailing = formatIncrementalLogUpdate(job, unseenEvents, config.IMESSAGE_LOG_LINES_PER_UPDATE);
      if (trailing && !shouldFlushLogs) {
        await sendIMessage(recipient, trailing, serviceId);
      }
      await sendIMessage(recipient, job.summary?.trim() || `Job #${job.jobNumber} completed.`, serviceId);
      return;
    }

    if (job.status === "failed") {
      const trailing = formatIncrementalLogUpdate(job, unseenEvents, config.IMESSAGE_LOG_LINES_PER_UPDATE);
      if (trailing && !shouldFlushLogs) {
        await sendIMessage(recipient, trailing, serviceId);
      }
      await sendIMessage(recipient, `Job #${job.jobNumber} failed: ${job.summary || "Unknown error."}`, serviceId);
      return;
    }

    if (job.status === "aborted") {
      await sendIMessage(recipient, `Job #${job.jobNumber} was aborted.`, serviceId);
      return;
    }

    await sleep(config.IMESSAGE_SYNC_POLL_MS);
  }
}

runLoop().catch((error) => {
  console.error(error);
  process.exit(1);
});
