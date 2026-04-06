import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import type { AppConfig } from "@imessage-pi-agent/shared";

const execFile = promisify(execFileCallback);

export type IncomingIMessage = {
  rowId: number;
  from: string;
  text: string;
};

type BridgeState = {
  lastSeenRowId: number;
};

const defaultDbCandidates = [
  path.join(os.homedir(), "Library", "Messages", "chat.db"),
  path.join(os.homedir(), "Library", "Group Containers", "com.apple.messages", "Library", "Messages", "chat.db")
];

export async function resolveIMessageDbPath(config: AppConfig): Promise<string> {
  const candidates = [config.IMESSAGE_DB_PATH, ...defaultDbCandidates].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      continue;
    }
  }

  throw new Error(
    "Could not read the Messages database. Grant Full Disk Access to the runner/terminal and set IMESSAGE_DB_PATH if needed."
  );
}

export function getBridgeStatePath(config: AppConfig): string {
  return config.IMESSAGE_STATE_PATH ?? path.join(config.WORKSPACE_ROOT, ".imessage-bridge-state.json");
}

export async function readBridgeState(statePath: string): Promise<BridgeState> {
  try {
    const raw = await readFile(statePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<BridgeState>;
    return {
      lastSeenRowId: typeof parsed.lastSeenRowId === "number" ? parsed.lastSeenRowId : 0
    };
  } catch {
    return { lastSeenRowId: 0 };
  }
}

export async function writeBridgeState(statePath: string, state: BridgeState): Promise<void> {
  await mkdir(path.dirname(statePath), { recursive: true });
  await writeFile(statePath, JSON.stringify(state, null, 2), "utf8");
}

function escapeSqlValue(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function decodeSqliteText(value: string): string {
  return value.replace(/\\n/g, "\n");
}

export function parseIncomingMessageRows(raw: string): IncomingIMessage[] {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split("\t"))
    .flatMap((parts) => {
      if (parts.length < 3) {
        return [];
      }
      const rowId = Number.parseInt(parts[0] ?? "", 10);
      const from = parts[1] ?? "";
      const text = parts.slice(2).join("\t");
      if (!Number.isFinite(rowId) || !from || !text) {
        return [];
      }
      return [{ rowId, from, text: decodeSqliteText(text) }];
    });
}

export async function getLatestIncomingRowId(dbPath: string, handles: string[]): Promise<number> {
  const sql = `
    SELECT COALESCE(MAX(message.ROWID), 0)
    FROM message
    JOIN handle ON handle.ROWID = message.handle_id
    WHERE message.is_from_me = 0
      AND handle.id IN (${handles.map(escapeSqlValue).join(", ")});
  `;
  const { stdout } = await runSqlite(dbPath, ["-readonly", "-noheader", dbPath, sql]);
  return Number.parseInt(stdout.trim() || "0", 10) || 0;
}

export async function pollIncomingMessages(dbPath: string, handles: string[], afterRowId: number): Promise<IncomingIMessage[]> {
  const sql = `
    SELECT message.ROWID, handle.id, REPLACE(IFNULL(message.text, ''), char(10), '\\n')
    FROM message
    JOIN handle ON handle.ROWID = message.handle_id
    WHERE message.is_from_me = 0
      AND message.ROWID > ${afterRowId}
      AND message.text IS NOT NULL
      AND handle.id IN (${handles.map(escapeSqlValue).join(", ")})
    ORDER BY message.ROWID ASC;
  `;

  const { stdout } = await runSqlite(dbPath, ["-readonly", "-separator", "\t", "-noheader", dbPath, sql]);
  return parseIncomingMessageRows(stdout);
}

async function runSqlite(dbPath: string, args: string[]) {
  try {
    return await execFile("sqlite3", args, { maxBuffer: 1024 * 1024 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("authorization denied")) {
      throw new Error(
        `Messages database access was denied for ${dbPath}. Grant Full Disk Access to Terminal and the launchd bridge process.`
      );
    }
    throw error;
  }
}

function escapeAppleScriptString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export async function discoverIMessageServiceId(): Promise<string> {
  const script = [
    'with timeout of 5 seconds',
    'tell application "Messages"',
    'set targetService to first service whose service type = iMessage',
    "get id of targetService",
    "end tell",
    "end timeout"
  ];
  const { stdout } = await execFile("osascript", script.flatMap((line) => ["-e", line]), { maxBuffer: 1024 * 1024 });
  return stdout.trim();
}

export async function sendIMessage(handle: string, text: string, serviceId?: string): Promise<void> {
  const targetServiceLine = serviceId
    ? `set targetService to first service whose id = "${escapeAppleScriptString(serviceId)}"`
    : 'set targetService to first service whose service type = iMessage';
  const script = [
    'with timeout of 10 seconds',
    'tell application "Messages"',
    targetServiceLine,
    `send "${escapeAppleScriptString(text)}" to participant "${escapeAppleScriptString(handle)}" of targetService`,
    "end tell",
    "end timeout"
  ];

  await execFile("osascript", script.flatMap((line) => ["-e", line]), { maxBuffer: 1024 * 1024 });
}
