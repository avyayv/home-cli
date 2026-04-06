import "./env.js";
import { appendFile } from "node:fs/promises";
import {
  createCorrelationId,
  getAllowedIMessageHandles,
  loadConfig
} from "@imessage-pi-agent/shared";
import { handleInboundIMessage } from "./handler.js";
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
        const reply = await handleInboundIMessage({ from: message.from, text: message.text });
        if (reply.trim()) {
          await sendIMessage(message.from, reply, serviceId);
        }
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

runLoop().catch((error) => {
  console.error(error);
  process.exit(1);
});
