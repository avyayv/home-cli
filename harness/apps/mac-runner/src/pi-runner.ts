import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import type { Job } from "@imessage-pi-agent/shared";
import { ControlPlaneStore } from "@imessage-pi-agent/shared";
import { Type, type AssistantMessage } from "@mariozechner/pi-ai";

type PiSdk = typeof import("@mariozechner/pi-coding-agent");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceAgentsTemplatePath = path.resolve(__dirname, "../../../ops/pi-workspace-AGENTS.md");

export type PiRunResult = {
  summary: string;
};

type ToolStartTelemetry = {
  message: string;
  details: Record<string, unknown>;
  stdoutChunk?: string;
};

type ToolEndTelemetry = {
  message: string;
  details: Record<string, unknown>;
  stdoutChunk?: string;
  stderrChunk?: string;
};

type LocalProviderConfig = {
  api: "openai-responses";
  baseUrl: string;
  apiKey: string;
  authHeader: boolean;
  models: Array<{
    id: string;
    name: string;
    api: "openai-responses";
    baseUrl: string;
    reasoning: boolean;
    input: Array<"text" | "image">;
    cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
    contextWindow: number;
    maxTokens: number;
  }>;
};

export function createLocalProviderConfig(baseUrl: string, modelId: string): LocalProviderConfig {
  return {
    api: "openai-responses" as const,
    baseUrl,
    apiKey: process.env.OPENAI_API_KEY ?? "ollama-local",
    authHeader: true,
    models: [
      {
        id: modelId,
        name: modelId,
        api: "openai-responses" as const,
        baseUrl,
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 32768,
        maxTokens: 8192
      }
    ]
  };
}

export function extractAssistantText(messages: AssistantMessage[]): string {
  return (
    messages
      .at(-1)
      ?.content.filter((item) => item.type === "text")
      .map((item) => item.text)
      .join("") ?? "Completed"
  );
}

const MAX_DETAIL_CHARS = 500;
const MAX_LOG_CHARS = 4000;

function truncateText(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, Math.max(0, limit - 3))}...` : value;
}

function collectTextContent(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const content = (value as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    return undefined;
  }

  const parts = content
    .map((item) => {
      if (!item || typeof item !== "object") {
        return undefined;
      }
      const text = (item as { text?: unknown }).text;
      return typeof text === "string" ? text : undefined;
    })
    .filter((item): item is string => Boolean(item));

  return parts.length > 0 ? parts.join("") : undefined;
}

function stringifyUnknown(value: unknown, limit: number): string | undefined {
  if (typeof value === "string") {
    return truncateText(value, limit);
  }

  if (value === undefined) {
    return undefined;
  }

  try {
    return truncateText(JSON.stringify(value, null, 2), limit);
  } catch {
    return truncateText(String(value), limit);
  }
}

export function buildToolStartTelemetry(event: { toolName?: unknown; args?: unknown }): ToolStartTelemetry {
  const toolName = typeof event.toolName === "string" ? event.toolName : "unknown";
  const args = event.args;

  if (toolName === "bash" && args && typeof args === "object" && typeof (args as { command?: unknown }).command === "string") {
    const command = (args as { command: string }).command;
    return {
      message: `Tool started: bash (${truncateText(command.replace(/\s+/g, " ").trim(), 100)})`,
      details: {
        argsPreview: truncateText(command, MAX_DETAIL_CHARS),
        timeout: typeof (args as { timeout?: unknown }).timeout === "number" ? (args as { timeout: number }).timeout : undefined
      },
      stdoutChunk: `$ ${truncateText(command, MAX_LOG_CHARS)}`
    };
  }

  return {
    message: `Tool started: ${toolName}`,
    details: {
      argsPreview: stringifyUnknown(args, MAX_DETAIL_CHARS)
    }
  };
}

export function buildToolEndTelemetry(event: {
  toolName?: unknown;
  result?: unknown;
  isError?: unknown;
}): ToolEndTelemetry {
  const toolName = typeof event.toolName === "string" ? event.toolName : "unknown";
  const result = event.result;
  const textResult =
    (result && typeof result === "object" && typeof (result as { stdout?: unknown }).stdout === "string"
      ? (result as { stdout: string }).stdout
      : undefined) ??
    collectTextContent(result) ??
    stringifyUnknown(result, MAX_LOG_CHARS);
  const stderrResult =
    result && typeof result === "object" && typeof (result as { stderr?: unknown }).stderr === "string"
      ? truncateText((result as { stderr: string }).stderr, MAX_LOG_CHARS)
      : undefined;

  return {
    message: `Tool finished: ${toolName}`,
    details: {
      isError: Boolean(event.isError),
      resultPreview: textResult ? truncateText(textResult, MAX_DETAIL_CHARS) : undefined
    },
    stdoutChunk: textResult ? truncateText(textResult, MAX_LOG_CHARS) : undefined,
    stderrChunk: stderrResult
  };
}

export class PiRunner {
  constructor(
    private readonly store: ControlPlaneStore,
    private readonly codexBin: string,
    private readonly promptTimeoutMs = 300000
  ) {}

  async run(job: Job): Promise<PiRunResult> {
    const sdk = await this.loadSdk();
    const cwd = await this.ensureJobWorkspace(job);

    await this.store.appendEvent(job.jobId, {
      eventId: randomUUID(),
      jobId: job.jobId,
      timestamp: new Date().toISOString(),
      phase: "planning",
      kind: "started",
      message: "Pi session starting",
      details: { cwd }
    });

    await this.store.appendEvent(job.jobId, {
      eventId: randomUUID(),
      jobId: job.jobId,
      timestamp: new Date().toISOString(),
      phase: "planning",
      kind: "update",
      message: "Pi SDK import complete",
      details: {}
    });

    process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? "ollama-local";
    process.env.OPENAI_BASE_URL = process.env.OPENAI_BASE_URL ?? process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434/v1";

    const { AuthStorage, ModelRegistry, SessionManager, createAgentSession, defineTool } = sdk;

    const authStorage = AuthStorage.inMemory();
    const modelRegistry = ModelRegistry.inMemory(authStorage);
    modelRegistry.registerProvider(
      "local-openai",
      createLocalProviderConfig(
        process.env.OLLAMA_BASE_URL ?? process.env.OPENAI_BASE_URL ?? "http://127.0.0.1:11434/v1",
        process.env.PI_MODEL_ID ?? "gemma4:31b"
      )
    );
    const model = modelRegistry.find("local-openai", process.env.PI_MODEL_ID ?? "gemma4:31b");
    if (!model) {
      throw new Error("Failed to register the local Pi model.");
    }

    await this.store.appendEvent(job.jobId, {
      eventId: randomUUID(),
      jobId: job.jobId,
      timestamp: new Date().toISOString(),
      phase: "planning",
      kind: "update",
      message: "Pi model registered",
      details: { provider: "local-openai", modelId: model.id }
    });

    const codexTool = defineTool({
      name: "spawn_codex_job",
      label: "Spawn Codex Job",
      description: "Run codex exec on this machine and stream progress back into the job log.",
      parameters: Type.Object({
        prompt: Type.String({ description: "Prompt to send to codex exec." })
      }),
      execute: async (_toolCallId: string, params: { prompt: string }) => {
        const output = await this.runCodex(job, params.prompt, cwd);
        return {
          content: [{ type: "text", text: output }],
          details: {}
        };
      }
    });

    await this.store.appendEvent(job.jobId, {
      eventId: randomUUID(),
      jobId: job.jobId,
      timestamp: new Date().toISOString(),
      phase: "planning",
      kind: "update",
      message: "Creating Pi session",
      details: {}
    });

    const { session } = await withTimeout(
      createAgentSession({
      cwd,
      modelRegistry,
      model,
      sessionManager: SessionManager.create(cwd),
      customTools: [codexTool]
      }),
      30000,
      "Timed out while creating Pi session"
    );

    await this.store.appendEvent(job.jobId, {
      eventId: randomUUID(),
      jobId: job.jobId,
      timestamp: new Date().toISOString(),
      phase: "planning",
      kind: "update",
      message: "Pi session created",
      details: {}
    });

    session.subscribe(async (event: Record<string, unknown>) => {
      if (event.type === "message_update" && (event as any).assistantMessageEvent?.type === "text_delta") {
        const delta = String((event as any).assistantMessageEvent.delta ?? "");
        if (delta.trim()) {
          await this.store.appendEvent(job.jobId, {
            eventId: randomUUID(),
            jobId: job.jobId,
            timestamp: new Date().toISOString(),
            phase: "planning",
            kind: "update",
            message: delta.slice(0, 160),
            details: {},
            stdoutChunk: delta
          });
        }
      }

      if (event.type === "tool_execution_start") {
        const telemetry = buildToolStartTelemetry(event as { toolName?: unknown; args?: unknown });
        await this.store.appendEvent(job.jobId, {
          eventId: randomUUID(),
          jobId: job.jobId,
          timestamp: new Date().toISOString(),
          phase: "tool",
          kind: "tool_start",
          message: telemetry.message,
          details: telemetry.details,
          stdoutChunk: telemetry.stdoutChunk
        });
      }

      if (event.type === "tool_execution_end") {
        const telemetry = buildToolEndTelemetry(event as { toolName?: unknown; result?: unknown; isError?: unknown });
        await this.store.appendEvent(job.jobId, {
          eventId: randomUUID(),
          jobId: job.jobId,
          timestamp: new Date().toISOString(),
          phase: "tool",
          kind: "tool_end",
          message: telemetry.message,
          details: telemetry.details,
          stdoutChunk: telemetry.stdoutChunk,
          stderrChunk: telemetry.stderrChunk
        });
      }
    });

    const prompt = job.promptQueue.shift();
    if (!prompt) {
      session.dispose();
      return { summary: "No pending prompts." };
    }
    await this.store.appendEvent(job.jobId, {
      eventId: randomUUID(),
      jobId: job.jobId,
      timestamp: new Date().toISOString(),
      phase: "planning",
      kind: "update",
      message: "Sending prompt to Pi",
      details: { prompt, remainingQueue: job.promptQueue.length }
    });

    await this.store.appendEvent(job.jobId, {
      eventId: randomUUID(),
      jobId: job.jobId,
      timestamp: new Date().toISOString(),
      phase: "planning",
      kind: "update",
      message: "Waiting for Pi prompt completion",
      details: { timeoutMs: this.promptTimeoutMs }
    });

    try {
      await withTimeout(session.prompt(prompt), this.promptTimeoutMs, "Timed out while waiting for Pi prompt execution");
    } catch (error) {
      session.dispose();
      throw error;
    }

    await this.store.appendEvent(job.jobId, {
      eventId: randomUUID(),
      jobId: job.jobId,
      timestamp: new Date().toISOString(),
      phase: "planning",
      kind: "update",
      message: "Pi prompt completed",
      details: {}
    });
    const assistantMessages = session.messages.filter((message): message is AssistantMessage => message.role === "assistant");
    const lastText = extractAssistantText(assistantMessages);
    session.dispose();

    return { summary: lastText.slice(0, 500) };
  }

  private async loadSdk(): Promise<PiSdk> {
    return import("@mariozechner/pi-coding-agent");
  }

  private async ensureJobWorkspace(job: Job): Promise<string> {
    const cwd = path.join(job.workspaceRoot, job.jobId);
    await mkdir(cwd, { recursive: true });
    await this.ensureWorkspaceAgents(job.workspaceRoot, cwd);
    return cwd;
  }

  private async ensureWorkspaceAgents(workspaceRoot: string, cwd: string): Promise<void> {
    const targets = [
      path.join(workspaceRoot, "AGENTS.md"),
      path.join(cwd, "AGENTS.md")
    ];

    await Promise.all(
      targets.map(async (target) => {
        try {
          await copyFile(workspaceAgentsTemplatePath, target);
        } catch {
          // Best-effort only; missing instructions should not block job execution.
        }
      })
    );
  }

  private async runCodex(job: Job, prompt: string, cwd: string): Promise<string> {
    await this.store.appendEvent(job.jobId, {
      eventId: randomUUID(),
      jobId: job.jobId,
      timestamp: new Date().toISOString(),
      phase: "codex",
      kind: "started",
      message: "Starting codex exec",
      details: { cwd }
    });

    const subprocess = execa(this.codexBin, ["exec", prompt], {
      cwd,
      all: true,
      reject: false
    });

    subprocess.all?.on("data", async (chunk) => {
      const text = chunk.toString();
      await this.store.appendEvent(job.jobId, {
        eventId: randomUUID(),
        jobId: job.jobId,
        timestamp: new Date().toISOString(),
        phase: "codex",
        kind: "stdout",
        message: "Codex output",
        details: {},
        stdoutChunk: text
      });
    });

    const result = await subprocess;
    if (result.exitCode !== 0) {
      throw new Error(`codex exec failed with exit code ${result.exitCode}`);
    }

    await this.store.appendEvent(job.jobId, {
      eventId: randomUUID(),
      jobId: job.jobId,
      timestamp: new Date().toISOString(),
      phase: "codex",
      kind: "completed",
      message: "Codex job completed",
      details: {}
    });

    return result.all ?? result.stdout;
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timeoutId: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(message)), ms);
      })
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}
