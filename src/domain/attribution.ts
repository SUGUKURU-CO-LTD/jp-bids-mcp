import { z } from "zod";

export const AttributionSchema = z.object({
  dataSource: z.literal("中小企業庁 官公需情報ポータルサイト"),
  apiEndpoint: z.literal("http://www.kkj.go.jp/api/"),
  licenseUrl: z.string().url(),
  serviceDisclaimer: z.string(),
  accessedAt: z.string().datetime(),
});

export type Attribution = z.infer<typeof AttributionSchema>;

export function createAttribution(accessedAt = new Date()): Attribution {
  return {
    dataSource: "中小企業庁 官公需情報ポータルサイト",
    apiEndpoint: "http://www.kkj.go.jp/api/",
    licenseUrl: "https://www.kkj.go.jp/s/help/notes/",
    serviceDisclaimer:
      "JP Bids MCP returns public procurement search results as reference information. Verify official documents before bidding.",
    accessedAt: accessedAt.toISOString(),
  };
}
