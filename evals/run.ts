// JP Bids MCP — Claude API 評価ハーネス
// Claude API (Messages API) で実際のモデルに JP Bids のツールを使わせ、
// 「正しいツールを選ぶか」「引数を正しく組むか」「ツールがエラーにならないか」を採点する。
//
// サーバーモード:
//   mock   : examples/mock-stdio-server.mjs（オフライン fixture。KKJ へ通信しない）
//   live   : dist/server.js（stdio。実際の KKJ API を呼ぶ）
//   remote : Messages API の MCP コネクタで本番 https://mcp.bid-jp.com/mcp を呼ぶ
//            （JP_BIDS_SERVICE_KEY が必要）
//
// 使い方: README.md を参照。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

// ---------- 設定 ----------

type ServerMode = "mock" | "live" | "remote";

interface Config {
  models: string[];
  server: ServerMode;
  caseFilter: string[];
  trials: number;
  budgetUsd: number;
  maxTurns: number;
  maxTokens: number;
  outDir: string;
  dryRun: boolean;
  failUnder: number | null;
  remoteUrl: string;
}

function readFlag(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

function pick(flag: string, env: string, fallback: string): string {
  const v = readFlag(flag) ?? process.env[env];
  return v === undefined || v.trim() === "" ? fallback : v.trim();
}

function loadConfig(): Config {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const server = pick("server", "EVAL_SERVER", "mock");
  if (server !== "mock" && server !== "live" && server !== "remote") {
    throw new Error(`EVAL_SERVER は mock / live / remote のいずれか: ${server}`);
  }
  const failUnderRaw = pick("fail-under", "EVAL_FAIL_UNDER", "");
  return {
    models: pick("models", "EVAL_MODELS", "claude-sonnet-5-5")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    server,
    caseFilter: pick("cases", "EVAL_CASES", "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    trials: Math.max(1, Number(pick("trials", "EVAL_TRIALS", "1"))),
    budgetUsd: Number(pick("budget", "EVAL_BUDGET_USD", "20")),
    maxTurns: Number(pick("max-turns", "EVAL_MAX_TURNS", "8")),
    maxTokens: Number(pick("max-tokens", "EVAL_MAX_TOKENS", "4096")),
    outDir: pick("out", "EVAL_OUT_DIR", path.join(__dirname, "results", stamp)),
    dryRun: process.argv.includes("--dry-run") || process.env.EVAL_DRY_RUN === "1",
    failUnder: failUnderRaw === "" ? null : Number(failUnderRaw),
    remoteUrl: pick("remote-url", "JP_BIDS_REMOTE_URL", "https://mcp.bid-jp.com/mcp"),
  };
}

// 料金（USD / 100万トークン）。出典: https://platform.claude.com/docs/en/models/overview
// （2026-11-18 確認）。キャッシュ・バッチ割引は考慮しない概算。実額は Claude Console の
// 「コスト」画面で確認すること。Haiku 5.5 は公式表記が「From」のため下限値。
const PRICING: Record<string, { input: number; output: number }> = {
  "claude-fable-5-2": { input: 8, output: 40 },
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
};

function estimateCost(model: string, input: number, output: number): number | null {
  const p = PRICING[model];
  if (!p) return null;
  return (input * p.input + output * p.output) / 1_000_000;
}

// ---------- ケース定義 ----------

type ArgOp = "eq" | "not_eq" | "in" | "contains" | "includes_all" | "lte" | "gte" | "exists";

interface ArgCheck {
  tool: string;
  path: string;
  op: ArgOp;
  value?: unknown;
  absent_ok?: boolean;
}

interface Expect {
  tools_any?: string[];
  tools_none?: string[];
  first_tool?: string[];
  tool_order?: string[];
  no_tools?: boolean;
  args?: ArgCheck[];
  answer_includes_any?: string[];
  answer_excludes?: string[];
  max_tool_errors?: number;
}

interface EvalCase {
  id: string;
  tags: string[];
  prompt: string;
  expect: Expect;
}

function loadCases(filter: string[]): EvalCase[] {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, "cases.json"), "utf8")) as {
    cases: EvalCase[];
  };
  if (filter.length === 0) return raw.cases;
  return raw.cases.filter((c) =>
    filter.some((f) => (f.startsWith("tag:") ? c.tags.includes(f.slice(4)) : c.id === f)),
  );
}

// ---------- 実行記録 ----------

interface ToolCall {
  name: string;
  input: Record<string, unknown>;
  isError: boolean;
  errorText?: string;
}

interface RunRecord {
  caseId: string;
  model: string;
  trial: number;
  toolCalls: ToolCall[];
  finalText: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
  latencyMs: number;
  stopReason: string;
  error?: string;
  passed: boolean;
  failures: string[];
}

// ---------- 採点 ----------

function toolMatches(pattern: string, name: string): boolean {
  if (pattern === "*") return true;
  if (pattern.includes("|")) return pattern.split("|").some((p) => toolMatches(p, name));
  if (pattern.includes("*")) {
    const re = new RegExp(`^${pattern.split("*").map(escapeRe).join(".*")}$`);
    return re.test(name);
  }
  return pattern === name;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function collectStrings(v: unknown, out: string[]): void {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) for (const x of v) collectStrings(x, out);
  else if (v && typeof v === "object") for (const x of Object.values(v)) collectStrings(x, out);
}

function getPath(input: Record<string, unknown>, p: string): unknown {
  if (p === "$text") {
    const all: string[] = [];
    collectStrings(input, all);
    return all.join(" ");
  }
  let cur: unknown = input;
  for (const key of p.split(".")) {
    if (cur && typeof cur === "object" && !Array.isArray(cur)) {
      cur = (cur as Record<string, unknown>)[key];
    } else {
      return undefined;
    }
  }
  return cur;
}

function asList(v: unknown): unknown[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

function checkOne(actual: unknown, chk: ArgCheck): boolean {
  if (actual === undefined && chk.absent_ok) return true;
  switch (chk.op) {
    case "exists":
      return actual !== undefined && actual !== null && actual !== "";
    case "eq":
      return actual === chk.value;
    case "not_eq":
      return actual !== chk.value;
    case "in":
      return Array.isArray(chk.value) && chk.value.includes(actual === undefined ? null : actual);
    case "contains":
      return asList(actual).some((x) => typeof x === "string" && x.includes(String(chk.value)));
    case "includes_all": {
      const got = asList(actual).map(String);
      return asList(chk.value).every((x) => got.includes(String(x)));
    }
    case "lte":
      return typeof actual === "number" && actual <= Number(chk.value);
    case "gte":
      return typeof actual === "number" && actual >= Number(chk.value);
    default:
      return false;
  }
}

function grade(c: EvalCase, rec: Omit<RunRecord, "passed" | "failures" | "trial">): string[] {
  const e = c.expect;
  const fails: string[] = [];
  const names = rec.toolCalls.map((t) => t.name);

  if (rec.error) fails.push(`実行エラー: ${rec.error}`);

  if (e.no_tools && names.length > 0) fails.push(`ツール不要のはずが呼んだ: ${names.join(", ")}`);

  if (e.tools_any && !names.some((n) => e.tools_any?.some((p) => toolMatches(p, n)))) {
    fails.push(
      `期待ツールが呼ばれない（候補: ${e.tools_any.join(" / ")}、実際: ${names.join(", ") || "なし"}）`,
    );
  }
  for (const p of e.tools_none ?? []) {
    if (names.some((n) => toolMatches(p, n))) fails.push(`呼ぶべきでないツールを呼んだ: ${p}`);
  }
  if (
    e.first_tool &&
    names.length > 0 &&
    !e.first_tool.some((p) => toolMatches(p, names[0] ?? ""))
  ) {
    fails.push(`最初のツールが想定外: ${names[0]}（想定: ${e.first_tool.join(" / ")}）`);
  }
  if (e.tool_order) {
    let idx = 0;
    for (const n of names) {
      const step = e.tool_order[idx];
      if (step && toolMatches(step, n)) idx++;
    }
    if (idx < e.tool_order.length) {
      fails.push(
        `呼び出し順が不足: ${e.tool_order.join(" → ")}（実際: ${names.join(" → ") || "なし"}）`,
      );
    }
  }
  for (const chk of e.args ?? []) {
    const calls = rec.toolCalls.filter((t) => toolMatches(chk.tool, t.name));
    if (calls.length === 0) {
      if (chk.op !== "not_eq")
        fails.push(`引数チェック対象のツール未呼び出し: ${chk.tool}.${chk.path}`);
      continue;
    }
    const ok = calls.some((t) =>
      chk.path.split("|").some((p) => checkOne(getPath(t.input, p), chk)),
    );
    if (!ok) {
      const seen = calls
        .map((t) => JSON.stringify(getPath(t.input, chk.path.split("|")[0] ?? "")))
        .join(", ");
      fails.push(
        `引数NG ${chk.tool}.${chk.path} ${chk.op} ${JSON.stringify(chk.value ?? "")}（実際: ${seen}）`,
      );
    }
  }
  const errCount = rec.toolCalls.filter((t) => t.isError).length;
  if (e.max_tool_errors !== undefined && errCount > e.max_tool_errors) {
    fails.push(`ツールエラー ${errCount} 件（許容 ${e.max_tool_errors}）`);
  }
  if (e.answer_includes_any && !e.answer_includes_any.some((w) => rec.finalText.includes(w))) {
    fails.push(`回答に必要な語がない（いずれか: ${e.answer_includes_any.join(" / ")}）`);
  }
  for (const w of e.answer_excludes ?? []) {
    if (rec.finalText.includes(w)) fails.push(`回答に含めてはいけない語: ${w}`);
  }
  return fails;
}

// ---------- 実行（ローカル stdio） ----------

interface LocalServer {
  client: Client;
  tools: Anthropic.Tool[];
}

async function startLocalServer(mode: "mock" | "live"): Promise<LocalServer> {
  const script = mode === "mock" ? "examples/mock-stdio-server.mjs" : "dist/server.js";
  if (!fs.existsSync(path.join(REPO_ROOT, "dist", "mcp.js"))) {
    throw new Error(
      "dist/ がありません。先にリポジトリ直下で npm run build:server を実行してください。",
    );
  }
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [script],
    cwd: REPO_ROOT,
    stderr: "ignore",
    env: { ...(process.env as Record<string, string>), JP_BIDS_PROFILE: "public_mvp" },
  });
  const client = new Client({ name: "jp-bids-evals", version: "1.0.0" });
  await client.connect(transport);
  const { tools } = await client.listTools();
  const anthropicTools: Anthropic.Tool[] = tools.map((t) => {
    const { $schema: _drop, ...schema } = t.inputSchema as Record<string, unknown>;
    return {
      name: t.name,
      description: t.description ?? "",
      input_schema: schema as Anthropic.Tool.InputSchema,
    };
  });
  return { client, tools: anthropicTools };
}

function systemPrompt(): string {
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date());
  return `今日の日付は ${today}（日本時間）です。`;
}

const TOOL_RESULT_MAX_CHARS = 30_000;

async function runLocal(
  anthropic: Anthropic,
  server: LocalServer,
  model: string,
  c: EvalCase,
  cfg: Config,
): Promise<Omit<RunRecord, "passed" | "failures" | "trial">> {
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: c.prompt }];
  const toolCalls: ToolCall[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let finalText = "";
  let stopReason = "";
  const started = Date.now();

  for (let turn = 0; turn < cfg.maxTurns; turn++) {
    const res = await anthropic.messages.create({
      model,
      max_tokens: cfg.maxTokens,
      system: systemPrompt(),
      tools: server.tools,
      messages,
    });
    inputTokens += res.usage.input_tokens;
    outputTokens += res.usage.output_tokens;
    stopReason = res.stop_reason ?? "";
    finalText = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    const uses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (res.stop_reason !== "tool_use" || uses.length === 0) break;

    messages.push({ role: "assistant", content: res.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const u of uses) {
      const input = (u.input ?? {}) as Record<string, unknown>;
      let text = "";
      let isError = false;
      try {
        const r = await server.client.callTool({ name: u.name, arguments: input });
        isError = r.isError === true;
        const content = Array.isArray(r.content) ? r.content : [];
        text = content
          .map((x) => (x && typeof x === "object" && "text" in x ? String(x.text) : ""))
          .join("\n");
      } catch (err) {
        isError = true;
        text = `MCP call failed: ${err instanceof Error ? err.message : String(err)}`;
      }
      toolCalls.push({
        name: u.name,
        input,
        isError,
        ...(isError ? { errorText: text.slice(0, 300) } : {}),
      });
      results.push({
        type: "tool_result",
        tool_use_id: u.id,
        content: text.slice(0, TOOL_RESULT_MAX_CHARS) || "(empty)",
        is_error: isError,
      });
    }
    messages.push({ role: "user", content: results });
  }

  return {
    caseId: c.id,
    model,
    toolCalls,
    finalText,
    inputTokens,
    outputTokens,
    costUsd: estimateCost(model, inputTokens, outputTokens),
    latencyMs: Date.now() - started,
    stopReason,
  };
}

// ---------- 実行（リモート: MCP コネクタ） ----------

const MCP_BETA = "mcp-client-2025-11-20";

async function runRemote(
  anthropic: Anthropic,
  model: string,
  c: EvalCase,
  cfg: Config,
): Promise<Omit<RunRecord, "passed" | "failures" | "trial">> {
  const token = process.env.JP_BIDS_SERVICE_KEY;
  if (!token) throw new Error("remote モードには JP_BIDS_SERVICE_KEY が必要です");
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: c.prompt }];
  const toolCalls: ToolCall[] = [];
  const pending = new Map<string, ToolCall>();
  let inputTokens = 0;
  let outputTokens = 0;
  let finalText = "";
  let stopReason = "";
  const started = Date.now();

  for (let turn = 0; turn < cfg.maxTurns; turn++) {
    const res = await anthropic.beta.messages.create({
      model,
      max_tokens: cfg.maxTokens,
      system: systemPrompt(),
      messages,
      mcp_servers: [
        { type: "url", url: cfg.remoteUrl, name: "jp-bids", authorization_token: token },
      ],
      tools: [{ type: "mcp_toolset", mcp_server_name: "jp-bids" }],
      betas: [MCP_BETA],
    });
    inputTokens += res.usage.input_tokens;
    outputTokens += res.usage.output_tokens;
    stopReason = res.stop_reason ?? "";
    const texts: string[] = [];
    for (const b of res.content) {
      if (b.type === "text") texts.push(b.text);
      if (b.type === "mcp_tool_use") {
        const call: ToolCall = {
          name: b.name,
          input: (b.input ?? {}) as Record<string, unknown>,
          isError: false,
        };
        pending.set(b.id, call);
        toolCalls.push(call);
      }
      if (b.type === "mcp_tool_result") {
        const call = pending.get(b.tool_use_id);
        if (call) {
          call.isError = b.is_error === true;
          if (call.isError) call.errorText = JSON.stringify(b.content).slice(0, 300);
        }
      }
    }
    finalText = texts.join("\n");
    if (res.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: res.content });
  }

  return {
    caseId: c.id,
    model,
    toolCalls,
    finalText,
    inputTokens,
    outputTokens,
    costUsd: estimateCost(model, inputTokens, outputTokens),
    latencyMs: Date.now() - started,
    stopReason,
  };
}

// ---------- レポート ----------

// 長い文字列（bid_ref など）は先頭と長さだけ表示する
function shortArgs(input: Record<string, unknown>): string {
  return JSON.stringify(input, (_k, v) =>
    typeof v === "string" && v.length > 60 ? `${v.slice(0, 16)}…(${v.length}文字)` : v,
  );
}

function pct(n: number, d: number): string {
  return d === 0 ? "-" : `${Math.round((n / d) * 100)}%`;
}

function usd(v: number): string {
  return `$${v.toFixed(3)}`;
}

function buildSummary(cfg: Config, records: RunRecord[], stoppedByBudget: boolean): string {
  const lines: string[] = [];
  lines.push("# JP Bids MCP 評価結果（Claude API）");
  lines.push("");
  lines.push(
    `- 実行日時: ${new Date().toISOString()} / サーバー: \`${cfg.server}\` / 試行回数: ${cfg.trials}`,
  );
  lines.push(
    "- 料金は公式単価からの概算（キャッシュ等の割引は未考慮）。実額は Claude Console で確認。",
  );
  if (stoppedByBudget) lines.push(`- ⚠ 予算上限 ${usd(cfg.budgetUsd)} に達したため途中で停止`);
  lines.push("");
  lines.push("## モデル別");
  lines.push("");
  lines.push("| モデル | 合格 | 合格率 | ツールエラー | 入力tok | 出力tok | 概算費用 |");
  lines.push("|---|---|---|---|---|---|---|");
  for (const m of cfg.models) {
    const rs = records.filter((r) => r.model === m);
    const pass = rs.filter((r) => r.passed).length;
    const errs = rs.reduce((s, r) => s + r.toolCalls.filter((t) => t.isError).length, 0);
    const inT = rs.reduce((s, r) => s + r.inputTokens, 0);
    const outT = rs.reduce((s, r) => s + r.outputTokens, 0);
    const cost = rs.reduce((s, r) => s + (r.costUsd ?? 0), 0);
    lines.push(
      `| ${m} | ${pass}/${rs.length} | ${pct(pass, rs.length)} | ${errs} | ${inT} | ${outT} | ${usd(cost)} |`,
    );
  }
  lines.push("");
  lines.push("## ケース別（合格数/試行数）");
  lines.push("");
  lines.push(`| ケース | ${cfg.models.join(" | ")} |`);
  lines.push(`|---|${cfg.models.map(() => "---").join("|")}|`);
  const caseIds = [...new Set(records.map((r) => r.caseId))];
  for (const id of caseIds) {
    const cells = cfg.models.map((m) => {
      const rs = records.filter((r) => r.caseId === id && r.model === m);
      const pass = rs.filter((r) => r.passed).length;
      return rs.length === 0 ? "-" : `${pass === rs.length ? "✅" : "❌"} ${pass}/${rs.length}`;
    });
    lines.push(`| ${id} | ${cells.join(" | ")} |`);
  }
  const failed = records.filter((r) => !r.passed);
  if (failed.length > 0) {
    lines.push("");
    lines.push("## 不合格の内訳");
    lines.push("");
    for (const r of failed) {
      const calls = r.toolCalls.map((t) => `${t.name}(${shortArgs(t.input)})`).join(" → ");
      lines.push(`### ${r.caseId} / ${r.model} / 試行${r.trial}`);
      for (const f of r.failures) lines.push(`- ${f}`);
      lines.push(`- 呼び出し: ${calls || "なし"}`);
      for (const t of r.toolCalls.filter((x) => x.isError)) {
        lines.push(`- エラー内容（${t.name}）: ${(t.errorText ?? "").replace(/\s+/g, " ")}`);
      }
      lines.push("");
    }
  }
  return lines.join("\n");
}

// ---------- メイン ----------

async function main(): Promise<void> {
  const cfg = loadConfig();
  const cases = loadCases(cfg.caseFilter);
  if (cases.length === 0) throw new Error("対象ケースが0件です（EVAL_CASES を確認）");

  let local: LocalServer | null = null;
  if (cfg.server !== "remote") local = await startLocalServer(cfg.server);

  // ケースが存在しないツール名を参照していないか確認
  if (local) {
    const known = new Set(local.tools.map((t) => t.name));
    for (const c of cases) {
      const refs = [
        ...(c.expect.tools_any ?? []),
        ...(c.expect.tools_none ?? []),
        ...(c.expect.first_tool ?? []),
        ...(c.expect.tool_order ?? []).flatMap((s) => s.split("|")),
        ...(c.expect.args ?? []).map((a) => a.tool),
      ].flatMap((s) => s.split("|"));
      for (const r of refs) {
        if (!r.includes("*") && !known.has(r)) {
          throw new Error(`ケース ${c.id} が未知のツール名を参照: ${r}`);
        }
      }
    }
  }

  if (cfg.dryRun) {
    const toolChars = local ? JSON.stringify(local.tools).length : 0;
    console.log(
      `[dry-run] server=${cfg.server} cases=${cases.length} models=${cfg.models.join(",")}`,
    );
    if (local) {
      console.log(`[dry-run] tools=${local.tools.map((t) => t.name).join(", ")}`);
      console.log(`[dry-run] ツール定義のサイズ: ${toolChars} 文字（毎ターンの入力に乗る）`);
    }
    console.log(`[dry-run] 実行予定: ${cases.length * cfg.models.length * cfg.trials} 回`);
    await local?.client.close();
    return;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY が未設定です（--dry-run なら不要）");
  }
  const anthropic = new Anthropic({ maxRetries: 4 });
  fs.mkdirSync(cfg.outDir, { recursive: true });

  const records: RunRecord[] = [];
  let spent = 0;
  let stoppedByBudget = false;

  outer: for (const model of cfg.models) {
    for (const c of cases) {
      for (let trial = 1; trial <= cfg.trials; trial++) {
        if (spent >= cfg.budgetUsd) {
          stoppedByBudget = true;
          break outer;
        }
        let base: Omit<RunRecord, "passed" | "failures" | "trial">;
        try {
          base =
            cfg.server === "remote"
              ? await runRemote(anthropic, model, c, cfg)
              : await runLocal(anthropic, local as LocalServer, model, c, cfg);
        } catch (err) {
          base = {
            caseId: c.id,
            model,
            toolCalls: [],
            finalText: "",
            inputTokens: 0,
            outputTokens: 0,
            costUsd: 0,
            latencyMs: 0,
            stopReason: "error",
            error: err instanceof Error ? err.message : String(err),
          };
        }
        const failures = grade(c, base);
        const rec: RunRecord = { ...base, trial, passed: failures.length === 0, failures };
        records.push(rec);
        spent += rec.costUsd ?? 0;
        console.log(
          `${rec.passed ? "PASS" : "FAIL"} ${model} ${c.id} #${trial} tools=[${rec.toolCalls
            .map((t) => t.name)
            .join(
              ",",
            )}] ${usd(rec.costUsd ?? 0)}${rec.passed ? "" : ` :: ${failures.join(" | ")}`}`,
        );
      }
    }
  }

  await local?.client.close();

  const summary = buildSummary(cfg, records, stoppedByBudget);
  fs.writeFileSync(path.join(cfg.outDir, "results.json"), JSON.stringify(records, null, 2));
  fs.writeFileSync(path.join(cfg.outDir, "summary.md"), summary);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  console.log(`\n結果: ${cfg.outDir}（概算費用合計 ${usd(spent)}）`);

  if (cfg.failUnder !== null) {
    for (const m of cfg.models) {
      const rs = records.filter((r) => r.model === m);
      const rate = rs.length === 0 ? 0 : rs.filter((r) => r.passed).length / rs.length;
      if (rate < cfg.failUnder) {
        console.error(`${m} の合格率 ${pct(rate * 100, 100)} が基準 ${cfg.failUnder} 未満`);
        process.exitCode = 1;
      }
    }
  }
}

// スクリプトとして直接実行されたときのみ main を呼ぶ（テストから import できるように）
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}

export { checkOne, grade, toolMatches };
