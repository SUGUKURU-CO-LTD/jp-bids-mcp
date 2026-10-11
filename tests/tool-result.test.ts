import { describe, expect, it, vi } from "vitest";
import { UpstreamError, UserInputError } from "../src/lib/errors.js";
import { toolError } from "../src/lib/tool-result.js";

describe("toolError", () => {
  it("surfaces UserInputError messages verbatim", () => {
    const result = toolError(new UserInputError("条件を絞ってください。"), "fallback");
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe("条件を絞ってください。");
  });

  it("maps a timeout into an actionable retry message", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const timeoutError = new DOMException("The operation timed out.", "TimeoutError");
    const result = toolError(timeoutError, "fallback");
    expect(result.content[0]?.text).toContain("応答が遅延");
    expect(result.content[0]?.text).toContain("30秒");
    vi.restoreAllMocks();
  });

  it("maps an UpstreamError with an HTTP status into a status-specific message", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = toolError(new UpstreamError("kkj.go.jp returned 503", 503), "fallback");
    expect(result.content[0]?.text).toContain("一時的な障害");
    expect(result.content[0]?.text).toContain("503");
    vi.restoreAllMocks();
  });

  it("maps an UpstreamError without a status into a generic upstream message", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = toolError(
      new UpstreamError("KKJ API response did not include Results"),
      "fallback",
    );
    expect(result.content[0]?.text).toContain("想定外の応答");
    vi.restoreAllMocks();
  });

  it("falls back to the provided message for unrecognized errors", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = toolError(new Error("something else"), "fallback message");
    expect(result.content[0]?.text).toBe("fallback message");
    vi.restoreAllMocks();
  });
});
