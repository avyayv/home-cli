import { describe, expect, it } from "vitest";
import { parseAgentCommand } from "./commands.js";

describe("parseAgentCommand", () => {
  it("parses run commands", () => {
    expect(parseAgentCommand("/run inspect the repo")).toMatchObject({
      type: "run",
      task: "inspect the repo",
      newJob: true
    });
  });

  it("defaults status target to latest", () => {
    expect(parseAgentCommand("/status")).toMatchObject({
      type: "status",
      target: "latest"
    });
  });

  it("parses logs with line count", () => {
    expect(parseAgentCommand("/logs 3 50")).toMatchObject({
      type: "logs",
      target: "3",
      lines: 50
    });
  });

  it("treats plain text as run input", () => {
    expect(parseAgentCommand("wat")).toMatchObject({
      type: "run",
      task: "wat",
      newJob: false
    });
  });
});
