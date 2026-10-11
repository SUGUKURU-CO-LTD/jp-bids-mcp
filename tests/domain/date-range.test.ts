import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { formatKkjDateRange, parseJapaneseDateToDate } from "../../src/domain/date-range.js";

describe("formatKkjDateRange", () => {
  it("formats open and closed KKJ date ranges", () => {
    expect(formatKkjDateRange("2026-05-01", "2026-05-10")).toBe("2026-05-01/2026-05-10");
    expect(formatKkjDateRange("2026-05-01", undefined)).toBe("2026-05-01/");
    expect(formatKkjDateRange(undefined, "2026-05-10")).toBe("/2026-05-10");
    expect(formatKkjDateRange("2026-05-01", "2026-05-01")).toBe("2026-05-01");
  });

  it("rejects non date-only values", () => {
    fc.assert(
      fc.property(
        fc.string().filter((value) => value.length > 0 && !/^\d{4}-\d{2}-\d{2}$/.test(value)),
        (value) => {
          expect(() => formatKkjDateRange(value, undefined)).toThrow();
        },
      ),
    );
  });
});

describe("parseJapaneseDateToDate", () => {
  it("parses ISO date strings", () => {
    const date = parseJapaneseDateToDate("2026-06-22");
    expect(date).not.toBeNull();
    expect(date?.toISOString().slice(0, 10)).toBe("2026-06-22");
  });

  it("parses slash-separated dates", () => {
    const date = parseJapaneseDateToDate("2026/06/22");
    expect(date?.toISOString().slice(0, 10)).toBe("2026-06-22");
  });

  it("parses wareki Reiwa dates", () => {
    const date = parseJapaneseDateToDate("令和8年6月22日17時00分");
    expect(date).not.toBeNull();
    expect(date?.toISOString().slice(0, 10)).toBe("2026-06-22");
  });

  it("parses wareki with R prefix", () => {
    const date = parseJapaneseDateToDate("R8年5月11日");
    expect(date?.toISOString().slice(0, 10)).toBe("2026-05-11");
  });

  it("returns null for empty or invalid input", () => {
    expect(parseJapaneseDateToDate(undefined)).toBeNull();
    expect(parseJapaneseDateToDate("")).toBeNull();
    expect(parseJapaneseDateToDate("not a date")).toBeNull();
  });
});
