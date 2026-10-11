import { UpstreamError, UserInputError } from "./errors.js";

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.name === "TimeoutError";
}

// KKJ側の一時的な障害・遅延をユーザーが次に取るべき行動とともに伝える
// Tell the user about transient KKJ-side failures/delays along with what to do next
// Sampaikan kegagalan/keterlambatan sementara di sisi KKJ beserta langkah yang bisa diambil pengguna
function describeUpstreamFailure(error: unknown): string | undefined {
  if (isTimeoutError(error)) {
    return "官公需情報ポータル（kkj.go.jp）の応答が遅延しています。30秒ほど待ってから同じ条件で再実行してください。 The KKJ portal is responding slowly. Wait about 30 seconds and retry with the same query.";
  }
  if (error instanceof UpstreamError) {
    if (error.status !== undefined) {
      return `官公需情報ポータル（kkj.go.jp）側で一時的な障害が発生している可能性があります（HTTP ${error.status}）。しばらく待ってから再実行してください。 The KKJ portal may be experiencing a temporary outage (HTTP ${error.status}). Please retry after a short wait.`;
    }
    return "官公需情報ポータル（kkj.go.jp）から想定外の応答がありました。しばらく待ってから再実行してください。 The KKJ portal returned an unexpected response. Please retry after a short wait.";
  }
  return undefined;
}

export function toolError(error: unknown, fallbackMessage: string) {
  if (error instanceof UserInputError) {
    return {
      isError: true,
      content: [{ type: "text" as const, text: error.message }],
    };
  }
  console.error(error);
  const upstreamMessage = describeUpstreamFailure(error);
  return {
    isError: true,
    content: [{ type: "text" as const, text: upstreamMessage ?? fallbackMessage }],
  };
}

export function jsonText(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

// MCP resource_link content block — 公式公告ページや添付資料へのリンクを返す
// MCP resource_link content block — return links to official announcement pages or attachments
// Blok konten resource_link MCP — kembalikan tautan ke halaman pengumuman resmi atau lampiran
export function resourceLink(uri: string, name: string, mimeType?: string) {
  return {
    type: "resource_link" as const,
    uri,
    name,
    ...(mimeType ? { mimeType } : {}),
  };
}
