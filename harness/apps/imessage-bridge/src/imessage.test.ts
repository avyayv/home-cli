import { describe, expect, it } from "vitest";
import { parseIncomingMessageRows } from "./imessage.js";

describe("parseIncomingMessageRows", () => {
  it("parses sqlite tab-separated rows", () => {
    const rows = parseIncomingMessageRows("101\t+15109355552\thello\\nworld\n102\t+15109355552\t/status");
    expect(rows).toEqual([
      { rowId: 101, from: "+15109355552", text: "hello\nworld" },
      { rowId: 102, from: "+15109355552", text: "/status" }
    ]);
  });
});
