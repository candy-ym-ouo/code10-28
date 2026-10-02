import { describe, expect, it } from "vitest";
import { formatDuration, formatTimeMs, parseTimeInput } from "../src/utils/format.js";

describe("audio time formatting", () => {
  it("round-trips millisecond marker values", () => {
    expect(formatTimeMs(65_432)).toBe("01:05.432");
    expect(parseTimeInput("01:05.432")).toBe(65_432);
  });

  it("formats session duration for UI", () => {
    expect(formatDuration(90_000)).toBe("2 分钟");
    expect(formatDuration(3_660_000)).toBe("1 小时 1 分钟");
  });

  it("rejects invalid time input", () => {
    expect(parseTimeInput("01:60")).toBeNull();
  });
});
