import { App } from "@modelcontextprotocol/ext-apps";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it, vi } from "vitest";

// Mock bidirectional transport simulating ChatGPT host postMessage bridge
class MockHostTransport implements Transport {
  public onmessage?: (message: JSONRPCMessage) => void;
  public onerror?: (error: Error) => void;
  public onclose?: () => void;
  public sessionId?: string;
  public sentMessages: JSONRPCMessage[] = [];
  public closed = false;

  private responder?: (message: JSONRPCMessage) => Promise<void> | void;

  setResponder(fn: (message: JSONRPCMessage) => Promise<void> | void) {
    this.responder = fn;
  }

  async start(): Promise<void> {
    this.closed = false;
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if (this.closed) throw new Error("Transport is closed");
    this.sentMessages.push(message);
    if (this.responder) {
      await this.responder(message);
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    this.onclose?.();
  }

  // Simulate incoming message from host to app
  receiveMessage(message: JSONRPCMessage): void {
    if (this.closed) return;
    this.onmessage?.(message);
  }
}

describe("MCP Apps Lifecycle & Initialization Verification (Offline / No KKJ)", () => {
  const PROTOCOL_VERSION = "2026-01-26";
  const dummyAppInfo = {
    name: "jp-bids-workspace",
    title: "AI Bid Workspace",
    version: "1.0.0",
  };

  /**
   * 試験 1: 初期化応答を遅延させても、ハンドラが先に登録され、最初の結果を取りこぼさないか
   */
  it("Test 1: When host initialize response is delayed, handlers pre-registered in onAppCreated receive toolresult without loss under strict:true", async () => {
    const transport = new MockHostTransport();
    let toolResultReceived: unknown = null;
    let initializeRequestSeen = false;

    // Simulate delayed host response
    transport.setResponder(async (msg) => {
      const rpc = msg as { id?: number | string; method?: string; params?: unknown };
      if (rpc.method === "ui/initialize") {
        initializeRequestSeen = true;
        // Simulate delay (e.g. 50ms) before responding
        await new Promise((resolve) => setTimeout(resolve, 50));
        transport.receiveMessage({
          jsonrpc: "2.0",
          id: rpc.id!,
          result: {
            protocolVersion: PROTOCOL_VERSION,
            hostInfo: { name: "mock-chatgpt-host", version: "1.0.0" },
            hostCapabilities: { updateModelContext: { text: {} } },
            hostContext: { theme: "light", displayMode: "inline" },
          },
        });
      }
    });

    const app = new App(dummyAppInfo, { availableDisplayModes: ["inline", "fullscreen"] }, { strict: true });

    // onAppCreated equivalent: register handlers BEFORE connect
    app.addEventListener("toolresult", (result: unknown) => {
      toolResultReceived = result;
    });

    // Initiate connection
    const connectPromise = app.connect(transport);
    // Yield to let super.connect() / transport.start() resolve and send ui/initialize
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(initializeRequestSeen).toBe(true);

    // Wait for connect to resolve
    await connectPromise;

    // Host now pushes tool result notification
    const sampleStructuredContent = {
      searchHits: 1,
      returnedCount: 1,
      bids: [{ key: "KKJ-TEST-001", projectName: "テスト案件" }],
    };
    transport.receiveMessage({
      jsonrpc: "2.0",
      method: "ui/notifications/tool-result",
      params: {
        structuredContent: sampleStructuredContent,
        content: [{ type: "text", text: "1件見つかりました。" }],
      },
    });

    // Yield to let protocol notification handlers process
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Verification: Tool result was received intact without throwing strict mode timing error
    expect(toolResultReceived).toBeDefined();
    expect((toolResultReceived as { structuredContent?: typeof sampleStructuredContent })?.structuredContent)
      .toEqual(sampleStructuredContent);

    await app.close();
  });

  /**
   * 試験 2: 初期化を失敗させたとき、待機表示のままにならず接続失敗が表示されるか
   */
  it("Test 2: When host initialize fails (rejects or errors), connect rejects promptly with explicit error instead of hanging in connecting state", async () => {
    const transport = new MockHostTransport();

    // Simulate host returning JSON-RPC error on ui/initialize
    transport.setResponder((msg) => {
      const rpc = msg as { id?: number | string; method?: string };
      if (rpc.method === "ui/initialize") {
        transport.receiveMessage({
          jsonrpc: "2.0",
          id: rpc.id!,
          error: {
            code: -32603,
            message: "Host security policy denied iframe app initialization",
          },
        });
      }
    });

    const app = new App(dummyAppInfo, { availableDisplayModes: ["inline", "fullscreen"] }, { strict: true });

    let capturedError: Error | null = null;
    try {
      await app.connect(transport);
    } catch (err) {
      capturedError = err instanceof Error ? err : new Error(String(err));
    }

    // Verification: Connect threw explicit error, transport closed, state transitioned to error
    expect(capturedError).not.toBeNull();
    expect(capturedError?.message).toContain("Host security policy denied iframe app initialization");
    expect(transport.closed).toBe(true);
  });

  /**
   * 試験 3: 再試行で古いリスナーを残さず接続できるか
   */
  it("Test 3: On retry after failure, old instance close() tears down listeners cleanly and new instance connects successfully", async () => {
    // --- Step A: First attempt fails ---
    const transport1 = new MockHostTransport();
    transport1.setResponder((msg) => {
      const rpc = msg as { id?: number | string; method?: string };
      if (rpc.method === "ui/initialize") {
        transport1.receiveMessage({
          jsonrpc: "2.0",
          id: rpc.id!,
          error: { code: -32000, message: "Transient handshake failure" },
        });
      }
    });

    const app1 = new App(dummyAppInfo, { availableDisplayModes: ["inline"] }, { strict: true });
    let app1ListenerCalled = false;
    app1.addEventListener("toolresult", () => {
      app1ListenerCalled = true;
    });

    await expect(app1.connect(transport1)).rejects.toThrow("Transient handshake failure");

    // Explicit cleanup as executed by React unmount / onReset
    await app1.close();
    expect(transport1.closed).toBe(true);

    // --- Step B: Second attempt (Retry) with fresh instance and transport succeeds ---
    const transport2 = new MockHostTransport();
    let app2ResultReceived: unknown = null;

    transport2.setResponder((msg) => {
      const rpc = msg as { id?: number | string; method?: string };
      if (rpc.method === "ui/initialize") {
        transport2.receiveMessage({
          jsonrpc: "2.0",
          id: rpc.id!,
          result: {
            protocolVersion: PROTOCOL_VERSION,
            hostInfo: { name: "mock-chatgpt-host", version: "1.0.0" },
            hostCapabilities: {},
            hostContext: { theme: "light" },
          },
        });
      }
    });

    const app2 = new App(dummyAppInfo, { availableDisplayModes: ["inline"] }, { strict: true });
    app2.addEventListener("toolresult", (res) => {
      app2ResultReceived = res;
    });

    await app2.connect(transport2);

    // Send tool result to transport2 (must satisfy CallToolResultSchema with content array)
    transport2.receiveMessage({
      jsonrpc: "2.0",
      method: "ui/notifications/tool-result",
      params: {
        content: [{ type: "text", text: "1件見つかりました。" }],
        structuredContent: { bids: [{ key: "RETRY-SUCCESS" }] },
      },
    });

    // Yield to let protocol notification handlers process
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Verification:
    // 1. New app received the result
    expect(app2ResultReceived).toBeDefined();
    expect((app2ResultReceived as { structuredContent?: { bids: Array<{ key: string }> } })?.structuredContent?.bids[0]?.key)
      .toBe("RETRY-SUCCESS");
    // 2. Old app listener was NOT invoked
    expect(app1ListenerCalled).toBe(false);

    await app2.close();
  });
});
