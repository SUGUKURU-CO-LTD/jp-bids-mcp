import { afterEach, describe, expect, it } from "vitest";
import { getBranding, resetBrandingCache } from "../src/lib/branding.js";

describe("branding", () => {
  afterEach(() => {
    resetBrandingCache();
    delete process.env.JP_BIDS_BRAND_NAME;
    delete process.env.JP_BIDS_BRAND_SHORT_NAME;
    delete process.env.JP_BIDS_BRAND_ORG;
  });

  it("returns default branding when no env vars set", () => {
    const b = getBranding();
    expect(b.serviceName).toBe("JP Bids");
    expect(b.organizationName).toBe("Sugukuru Inc.");
  });

  it("overrides branding via env vars", () => {
    process.env.JP_BIDS_BRAND_NAME = "MyBids Pro";
    process.env.JP_BIDS_BRAND_SHORT_NAME = "MyBids";
    process.env.JP_BIDS_BRAND_ORG = "Acme Corp";
    const b = getBranding();
    expect(b.serviceName).toBe("MyBids Pro");
    expect(b.serviceShortName).toBe("MyBids");
    expect(b.organizationName).toBe("Acme Corp");
  });

  it("caches branding after first call", () => {
    const b1 = getBranding();
    process.env.JP_BIDS_BRAND_NAME = "Changed";
    const b2 = getBranding();
    expect(b1).toBe(b2);
    expect(b2.serviceName).toBe("JP Bids");
  });

  it("resetBrandingCache clears cache", () => {
    getBranding();
    process.env.JP_BIDS_BRAND_NAME = "After Reset";
    resetBrandingCache();
    const b = getBranding();
    expect(b.serviceName).toBe("After Reset");
  });
});
