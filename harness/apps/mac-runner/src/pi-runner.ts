import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import type { Job } from "@twilio-pi-agent/shared";
import { ControlPlaneStore } from "@twilio-pi-agent/shared";
import { Type, type AssistantMessage } from "@mariozechner/pi-ai";

type PiSdk = typeof import("@mariozechner/pi-coding-agent");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceAgentsTemplatePath = path.resolve(__dirname, "../../../ops/pi-workspace-AGENTS.md");

export type PiRunResult = {
  summary: string;
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
        await this.store.appendEvent(job.jobId, {
          eventId: randomUUID(),
          jobId: job.jobId,
          timestamp: new Date().toISOString(),
          phase: "tool",
          kind: "tool_start",
          message: `Tool started: ${String((event as any).toolName ?? "unknown")}`,
          details: {}
        });
      }

      if (event.type === "tool_execution_end") {
        await this.store.appendEvent(job.jobId, {
          eventId: randomUUID(),
          jobId: job.jobId,
          timestamp: new Date().toISOString(),
          phase: "tool",
          kind: "tool_end",
          message: `Tool finished: ${String((event as any).toolName ?? "unknown")}`,
          details: { isError: Boolean((event as any).isError) }
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
