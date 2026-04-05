import { describe, expect, it } from "vitest";
import type { JobEvent } from "./types.js";

describe("legacy event parsing", () => {
  it("flattens nested stringified arrays of event records", async () => {
    const validEvent: JobEvent = {
      eventId: "evt_1",
      jobId: "job_1",
      timestamp: new Date().toISOString(),
      phase: "queue",
      kind: "queued",
      message: "Prompt queued for job #1",
      details: { prompt: "hello" }
    };

    const module = await import("./redis-store.js");
    const records = (module as unknown as { __test_parseEventRecords?: (value: unknown) => JobEvent[] }).__test_parseEventRecords?.([
      JSON.stringify(validEvent),
      [JSON.stringify(validEvent)]
    ]);

    expect(records).toHaveLength(2);
    expect(records?.[0]?.message).toBe("Prompt queued for job #1");
  });
});
