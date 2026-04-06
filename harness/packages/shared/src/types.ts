import { z } from "zod";

export const commandTypeSchema = z.enum(["run", "status", "logs", "abort", "confirm", "help", "jobs"]);
export type CommandType = z.infer<typeof commandTypeSchema>;

export const jobStatusSchema = z.enum([
  "queued",
  "awaiting_confirmation",
  "running",
  "completed",
  "failed",
  "aborted"
]);
export type JobStatus = z.infer<typeof jobStatusSchema>;

export const executorKindSchema = z.enum(["pi", "codex"]);
export type ExecutorKind = z.infer<typeof executorKindSchema>;

export const eventPhaseSchema = z.enum([
  "ingress",
  "queue",
  "runner",
  "planning",
  "tool",
  "codex",
  "confirmation",
  "completion",
  "error"
]);
export type EventPhase = z.infer<typeof eventPhaseSchema>;

export const eventKindSchema = z.enum([
  "accepted",
  "queued",
  "started",
  "update",
  "tool_start",
  "tool_end",
  "stdout",
  "stderr",
  "waiting_confirmation",
  "completed",
  "failed",
  "aborted"
]);
export type EventKind = z.infer<typeof eventKindSchema>;

export const baseCommandSchema = z.object({
  type: commandTypeSchema,
  rawText: z.string().min(1)
});

export const runCommandSchema = baseCommandSchema.extend({
  type: z.literal("run"),
  task: z.string().min(1),
  newJob: z.boolean().default(false),
  loggingEnabled: z.boolean().default(false),
  loggingIntervalSeconds: z.number().int().positive().max(300).optional()
});

export const statusCommandSchema = baseCommandSchema.extend({
  type: z.literal("status"),
  target: z.string().default("latest")
});

export const logsCommandSchema = baseCommandSchema.extend({
  type: z.literal("logs"),
  target: z.string().default("latest"),
  lines: z.number().int().positive().max(200).default(25)
});

export const abortCommandSchema = baseCommandSchema.extend({
  type: z.literal("abort"),
  target: z.string().default("latest")
});

export const confirmCommandSchema = baseCommandSchema.extend({
  type: z.literal("confirm"),
  token: z.string().min(4)
});

export const helpCommandSchema = baseCommandSchema.extend({
  type: z.literal("help")
});

export const jobsCommandSchema = baseCommandSchema.extend({
  type: z.literal("jobs"),
  target: z.string().optional()
});

export const agentCommandSchema = z.discriminatedUnion("type", [
  runCommandSchema,
  statusCommandSchema,
  logsCommandSchema,
  abortCommandSchema,
  confirmCommandSchema,
  helpCommandSchema,
  jobsCommandSchema
]);
export type AgentCommand = z.infer<typeof agentCommandSchema>;

export const jobSchema = z.object({
  jobId: z.string().min(1),
  jobNumber: z.number().int().positive(),
  source: z.enum(["imessage", "admin"]),
  sender: z.string().min(1),
  command: agentCommandSchema,
  status: jobStatusSchema,
  summary: z.string().default(""),
  requiresConfirmation: z.boolean().default(false),
  confirmationToken: z.string().optional(),
  confirmationRequestedAt: z.string().optional(),
  activeExecutor: executorKindSchema.optional(),
  workspaceRoot: z.string().min(1),
  promptQueue: z.array(z.string()).default([]),
  createdAt: z.string(),
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
  correlationId: z.string().min(1)
});
export type Job = z.infer<typeof jobSchema>;

export const jobEventSchema = z.object({
  eventId: z.string().min(1),
  jobId: z.string().min(1),
  timestamp: z.string(),
  phase: eventPhaseSchema,
  kind: eventKindSchema,
  message: z.string().min(1),
  details: z.record(z.string(), z.unknown()).default({}),
  stdoutChunk: z.string().optional(),
  stderrChunk: z.string().optional()
});
export type JobEvent = z.infer<typeof jobEventSchema>;

export const enqueueCommandSchema = z.object({
  sender: z.string().min(1),
  command: agentCommandSchema,
  receivedAt: z.string(),
  correlationId: z.string().min(1)
});
export type EnqueueCommand = z.infer<typeof enqueueCommandSchema>;
