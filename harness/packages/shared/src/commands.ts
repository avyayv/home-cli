import { randomUUID } from "node:crypto";
import {
  abortCommandSchema,
  AgentCommand,
  confirmCommandSchema,
  helpCommandSchema,
  jobsCommandSchema,
  logsCommandSchema,
  runCommandSchema,
  statusCommandSchema
} from "./types.js";

const whitespace = /\s+/;

export function parseAgentCommand(rawText: string): AgentCommand {
  const trimmed = rawText.trim();
  if (!trimmed) {
    return helpCommandSchema.parse({ type: "help", rawText: rawText || "help" });
  }

  if (!trimmed.startsWith("/")) {
    return runCommandSchema.parse({ type: "run", rawText: trimmed, task: trimmed, newJob: false });
  }

  const [verbWithSlash, ...rest] = trimmed.split(whitespace);
  const verbRaw = verbWithSlash.replace(/^\//, "");
  const verb = verbRaw.toLowerCase();
  const restText = rest.join(" ").trim();

  switch (verb) {
    case "run":
      return runCommandSchema.parse({ type: "run", rawText: trimmed, task: restText, newJob: true });
    case "status":
      return statusCommandSchema.parse({ type: "status", rawText: trimmed, target: restText || "latest" });
    case "logs": {
      const [target = "latest", linesRaw] = rest;
      const parsedLines = linesRaw ? Number.parseInt(linesRaw, 10) : 25;
      return logsCommandSchema.parse({
        type: "logs",
        rawText: trimmed,
        target,
        lines: Number.isFinite(parsedLines) ? parsedLines : 25
      });
    }
    case "abort":
      return abortCommandSchema.parse({ type: "abort", rawText: trimmed, target: restText || "latest" });
    case "confirm":
      return confirmCommandSchema.parse({ type: "confirm", rawText: trimmed, token: restText });
    case "help":
      return helpCommandSchema.parse({ type: "help", rawText: trimmed });
    case "jobs":
      return jobsCommandSchema.parse({ type: "jobs", rawText: trimmed, target: restText || undefined });
    default:
      return helpCommandSchema.parse({ type: "help", rawText: trimmed });
  }
}

export function buildHelpText(): string {
  return [
    "Commands:",
    "/run <task>  start a new job",
    "/status <jobId|latest>",
    "/logs <jobId|latest> [lines]",
    "/abort <jobId|latest>",
    "/confirm <token>",
    "/jobs [jobNumber]",
    "/help",
    "",
    "Plain text goes to the current job."
  ].join("\n");
}

export function createCorrelationId(prefix = "imessage"): string {
  return `${prefix}_${randomUUID()}`;
}

export function requiresConfirmation(task: string): boolean {
  const patterns = [
    /\brm\b/i,
    /\bgit\s+reset\b/i,
    /\bgit\s+clean\b/i,
    /\bbrew\s+install\b/i,
    /\bnpm\s+publish\b/i,
    /\bdeploy\b/i,
    /\bdelete\b/i,
    /\bdrop\b/i,
    /\bshutdown\b/i,
    /\breboot\b/i
  ];
  return patterns.some((pattern) => pattern.test(task));
}
