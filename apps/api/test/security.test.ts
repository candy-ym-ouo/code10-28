import { describe, expect, it } from "vitest";
import { durationToMs } from "../src/lib/security.js";

describe("durationToMs", () => {
  it("parses supported TTL units", () => {
    expect(durationToMs("15m")).toBe(900_000);
    expect(durationToMs("30d")).toBe(2_592_000_000);
  });

  it("rejects unsupported values", () => {
    expect(() => durationToMs("15 minutes")).toThrow("Unsupported duration");
  });
});
