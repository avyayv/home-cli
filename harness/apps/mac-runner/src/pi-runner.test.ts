import { describe, expect, it } from "vitest";
import type { AssistantMessage } from "@mariozechner/pi-ai";
import { createLocalProviderConfig, extractAssistantText } from "./pi-runner.js";

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
