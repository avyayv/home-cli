import { describe, expect, it } from "vitest";
import type { AssistantMessage } from "@mariozechner/pi-ai";
import {
  buildToolEndTelemetry,
  buildToolStartTelemetry,
  createLocalProviderConfig,
  extractAssistantText
} from "./pi-runner.js";

describe("createLocalProviderConfig", () => {
  it("builds a local openai-compatible provider config", () => {
    const config = createLocalProviderConfig("http://127.0.0.1:11434/v1", "gemma4:31b");
    expect(config.api).toBe("openai-responses");
    expect(config.models[0]?.id).toBe("gemma4:31b");
    expect(config.models[0]?.baseUrl).toBe("http://127.0.0.1:11434/v1");
  });
});

describe("extractAssistantText", () => {
  it("returns joined text segments from the last assistant message", () => {
    const messages: AssistantMessage[] = [
      {
        role: "assistant",
        api: "openai-responses",
        provider: "openai",
        model: "gemma4:31b",
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: "stop",
        timestamp: Date.now(),
        content: [
          { type: "thinking", thinking: "hidden" },
          { type: "text", text: "hello " },
          { type: "text", text: "world" }
        ]
      }
    ];
    expect(extractAssistantText(messages)).toBe("hello world");
  });
});

describe("buildToolStartTelemetry", () => {
  it("captures bash commands for log visibility", () => {
    const telemetry = buildToolStartTelemetry({
      toolName: "bash",
      args: { command: "gree mode heat && gree temp 70", timeout: 120000 }
    });

    expect(telemetry.message).toContain("Tool started: bash");
    expect(telemetry.stdoutChunk).toContain("gree mode heat && gree temp 70");
    expect(telemetry.details.argsPreview).toContain("gree mode heat");
  });
});

describe("buildToolEndTelemetry", () => {
  it("extracts text result content for logs", () => {
    const telemetry = buildToolEndTelemetry({
      toolName: "bash",
      isError: false,
      result: {
        content: [
          { type: "text", text: "ok\n" },
          { type: "text", text: "set to heat" }
        ]
      }
    });

    expect(telemetry.message).toBe("Tool finished: bash");
    expect(telemetry.stdoutChunk).toContain("set to heat");
    expect(telemetry.details.resultPreview).toContain("ok");
  });
});
