import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { prefectureEntries, toLgCode } from "../../src/domain/prefectures.js";

describe("prefecture code conversion", () => {
  it("converts known prefectures to JIS X0401 codes", () => {
    expect(toLgCode("鹿児島県")).toBe("46");
    expect(toLgCode(["東京都", "大阪府", "鹿児島県"])).toBe("13,27,46");
  });

  it("contains unique two-digit codes", () => {
    fc.assert(
      fc.property(fc.constantFrom(...prefectureEntries), (entry) => {
        expect(entry.code).toMatch(/^\d{2}$/);
        expect(toLgCode(entry.name)).toBe(entry.code);
      }),
    );
    expect(new Set(prefectureEntries.map((entry) => entry.code)).size).toBe(47);
  });
});
