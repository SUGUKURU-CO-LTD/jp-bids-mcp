import { type McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { KkjClient } from "../api/kkj-client.js";
import { createAttribution } from "../domain/attribution.js";
import { prefectureCodeToName, prefectureEntries } from "../domain/prefectures.js";
import type { ServerProfile } from "../lib/profile.js";
import { jsonText } from "../lib/tool-result.js";

const resourceLastModified = "2026-05-02T00:00:00.000Z";

export function registerResources(
  server: McpServer,
  _client: KkjClient,
  _profile: ServerProfile = "public_mvp",
): void {
  server.registerResource(
    "kkj_attribution",
    "attribution://kkj",
    {
      title: "KKJ Attribution",
      description:
        "官公需情報ポータルサイトの出典情報。Attribution metadata for the KKJ procurement portal. Metadata atribusi untuk portal pengadaan KKJ.",
      mimeType: "application/json",
      annotations: {
        audience: ["user", "assistant"],
        priority: 1,
        lastModified: resourceLastModified,
      },
    },
    (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: jsonText(createAttribution()),
        },
      ],
    }),
  );

  server.registerResource(
    "kkj_api_reference",
    "docs://api-reference",
    {
      title: "KKJ API Reference",
      description:
        "JP Bids MCPで使うKKJ APIパラメータの要約。Summary of KKJ API parameters used by JP Bids MCP. Ringkasan parameter API KKJ yang digunakan JP Bids MCP.",
      mimeType: "text/markdown",
      annotations: {
        audience: ["assistant"],
        priority: 0.8,
        lastModified: resourceLastModified,
      },
    },
    (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "text/markdown",
          text: [
            "# KKJ API Reference",
            "",
            "- Endpoint: `http://www.kkj.go.jp/api/`",
            "- Required: one of `Query`, `Project_Name`, `Organization_Name`, `LG_Code`",
            "- Response: XML",
            "- Count: max 1,000",
          ].join("\n"),
        },
      ],
    }),
  );

  server.registerResource(
    "prefecture_codes",
    "codes://prefectures",
    {
      title: "JIS X0401 Prefecture Codes",
      description:
        "都道府県名とLG_Codeの対応表。Mapping of prefecture names to JIS X0401 LG codes. Peta nama prefektur ke kode LG JIS X0401.",
      mimeType: "application/json",
      annotations: {
        audience: ["user", "assistant"],
        priority: 0.7,
        lastModified: resourceLastModified,
      },
    },
    (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: jsonText(prefectureEntries),
        },
      ],
    }),
  );

  server.registerResource(
    "prefecture_template",
    new ResourceTemplate("prefecture://{lg_code}", {
      list: undefined,
      complete: {
        lg_code: (value) =>
          prefectureEntries
            .map((entry) => entry.code)
            .filter((code) => code.startsWith(value))
            .slice(0, 47),
      },
    }),
    {
      title: "Prefecture Code Template",
      description:
        "LG_Codeから都道府県名を参照する。Look up prefecture name from a JIS LG_Code. Cari nama prefektur berdasarkan kode LG JIS.",
      mimeType: "application/json",
      annotations: {
        audience: ["user", "assistant"],
        priority: 0.6,
        lastModified: resourceLastModified,
      },
    },
    (uri, variables) => {
      const code = String(variables.lg_code ?? "");
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: jsonText({ code, name: prefectureCodeToName.get(code) ?? null }),
          },
        ],
      };
    },
  );
}
