import { z } from "zod";

const baseEnvSchema = z.object({
  UPSTASH_REDIS_REST_URL: z.url(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1),
  ALLOWED_SMS_FROM: z.string().min(4),
  WORKSPACE_ROOT: z.string().min(1),
  OLLAMA_BASE_URL: z.string().default("http://127.0.0.1:11434/v1"),
  PI_MODEL_PROVIDER: z.string().default("openai"),
  PI_MODEL_ID: z.string().default("gemma4:31b"),
  CODEX_BIN: z.string().default("codex"),
  JOB_QUEUE_KEY: z.string().default("twilio-pi-agent:jobs"),
  JOB_KEY_PREFIX: z.string().default("twilio-pi-agent:job:"),
  EVENT_KEY_PREFIX: z.string().default("twilio-pi-agent:events:"),
  LATEST_JOB_KEY_PREFIX: z.string().default("twilio-pi-agent:latest:"),
  CURRENT_JOB_KEY_PREFIX: z.string().default("twilio-pi-agent:current:"),
  SENDER_JOBS_KEY_PREFIX: z.string().default("twilio-pi-agent:sender-jobs:"),
  NEXT_JOB_NUMBER_KEY_PREFIX: z.string().default("twilio-pi-agent:next-job-number:"),
  RUNNER_CONCURRENCY: z.coerce.number().int().positive().default(2),
  PI_PROMPT_TIMEOUT_MS: z.coerce.number().int().positive().default(300000),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_PHONE_NUMBER: z.string().optional(),
  TWILIO_WEBHOOK_AUTH_TOKEN: z.string().optional()
});

export type AppConfig = z.infer<typeof baseEnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return baseEnvSchema.parse(env);
}

export function getAllowedSmsSenders(cfg: AppConfig): string[] {
  return cfg.ALLOWED_SMS_FROM.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}
