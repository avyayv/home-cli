import { describe, expect, it } from "vitest";
import { parseSmsCommand } from "./commands.js";

describe("parseSmsCommand", () => {
  it("parses run commands", () => {
    expect(parseSmsCommand("/run inspect the repo")).toMatchObject({
      type: "run",
      task: "inspect the repo",
      newJob: true
    });
  });

  it("defaults status target to latest", () => {
    expect(parseSmsCommand("/status")).toMatchObject({
      type: "status",
      target: "latest"
    });
  });

  it("parses logs with line count", () => {
    expect(parseSmsCommand("/logs 3 50")).toMatchObject({
      type: "logs",
      target: "3",
      lines: 50
    });
  });

  it("treats plain text as run input", () => {
    expect(parseSmsCommand("wat")).toMatchObject({
      type: "run",
      task: "wat",
      newJob: false
    });
  });
});
