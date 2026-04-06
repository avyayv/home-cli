import { z } from "zod";

const baseEnvSchema = z.object({
  UPSTASH_REDIS_REST_URL: z.url(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1),
  ALLOWED_IMESSAGE_HANDLES: z.string().min(1),
  WORKSPACE_ROOT: z.string().min(1),
  OLLAMA_BASE_URL: z.string().default("http://127.0.0.1:11434/v1"),
  PI_MODEL_PROVIDER: z.string().default("openai"),
  PI_MODEL_ID: z.string().default("gemma4:31b"),
  CODEX_BIN: z.string().default("codex"),
  IMESSAGE_DB_PATH: z.string().optional(),
  IMESSAGE_STATE_PATH: z.string().optional(),
  IMESSAGE_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(4000),
  IMESSAGE_SYNC_TIMEOUT_MS: z.coerce.number().int().positive().default(120000),
  IMESSAGE_SYNC_POLL_MS: z.coerce.number().int().positive().default(1000),
  IMESSAGE_LOG_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
  IMESSAGE_LOG_LINES_PER_UPDATE: z.coerce.number().int().positive().max(20).default(5),
  IMESSAGE_SERVICE_ID: z.string().optional(),
  JOB_QUEUE_KEY: z.string().default("imessage-pi-agent:jobs"),
  JOB_KEY_PREFIX: z.string().default("imessage-pi-agent:job:"),
  EVENT_KEY_PREFIX: z.string().default("imessage-pi-agent:events:"),
  LATEST_JOB_KEY_PREFIX: z.string().default("imessage-pi-agent:latest:"),
  CURRENT_JOB_KEY_PREFIX: z.string().default("imessage-pi-agent:current:"),
  SENDER_JOBS_KEY_PREFIX: z.string().default("imessage-pi-agent:sender-jobs:"),
  NEXT_JOB_NUMBER_KEY_PREFIX: z.string().default("imessage-pi-agent:next-job-number:"),
  RUNNER_CONCURRENCY: z.coerce.number().int().positive().default(2),
  PI_PROMPT_TIMEOUT_MS: z.coerce.number().int().positive().default(300000)
});

export type AppConfig = z.infer<typeof baseEnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return baseEnvSchema.parse(env);
}

export function getAllowedIMessageHandles(cfg: AppConfig): string[] {
  return cfg.ALLOWED_IMESSAGE_HANDLES.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}
