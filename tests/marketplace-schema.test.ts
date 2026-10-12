import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "..");
const MARKETPLACE_PATH = path.join(REPO_ROOT, ".agents", "plugins", "marketplace.json");
const PLUGIN_PATH = path.join(REPO_ROOT, "plugins", "jp-bids-mcp", "plugin.json");
const PLUGIN_DIR = path.join(REPO_ROOT, "plugins", "jp-bids-mcp");
const SKILL_PATH = path.join(PLUGIN_DIR, "skills", "search-bids", "SKILL.md");
const PLUGIN_SCHEMA_PATH = path.join(
  REPO_ROOT,
  "tests",
  "fixtures",
  "schemas",
  "plugin.schema.json",
);
const MCP_SCHEMA_PATH = path.join(REPO_ROOT, "tests", "fixtures", "schemas", "mcp.schema.json");

describe("GitHub Marketplace & Agent Plugins 1.0.0 Compliance", () => {
  const ajv = new Ajv2020({ allErrors: true });
  const pluginSchema = JSON.parse(fs.readFileSync(PLUGIN_SCHEMA_PATH, "utf8"));
  const mcpSchema = JSON.parse(fs.readFileSync(MCP_SCHEMA_PATH, "utf8"));
  const validatePlugin = ajv.compile(pluginSchema);
  const validateMcp = ajv.compile(mcpSchema);

  it("validates .agents/plugins/marketplace.json catalog structure", () => {
    expect(fs.existsSync(MARKETPLACE_PATH)).toBe(true);
    const content = fs.readFileSync(MARKETPLACE_PATH, "utf8");
    const json = JSON.parse(content);

    expect(typeof json.name).toBe("string");
    expect(json.name).toBe("sugukuru-jp-bids-marketplace");
    expect(typeof json.interface?.displayName).toBe("string");
    expect(Array.isArray(json.plugins)).toBe(true);
    expect(json.plugins.length).toBeGreaterThan(0);

    const pluginRef = json.plugins[0];
    expect(pluginRef.name).toBe("jp-bids-mcp");
    expect(pluginRef.source?.source).toBe("local");
    expect(pluginRef.source?.path).toBe("./plugins/jp-bids-mcp");

    const resolvedPluginDir = path.resolve(REPO_ROOT, pluginRef.source.path);
    expect(fs.existsSync(resolvedPluginDir)).toBe(true);
  });

  it("validates plugins/jp-bids-mcp/plugin.json strictly matches official 1.0.0 schema", () => {
    expect(fs.existsSync(PLUGIN_PATH)).toBe(true);
    const content = fs.readFileSync(PLUGIN_PATH, "utf8");
    const json = JSON.parse(content);

    const valid = validatePlugin(json);
    if (!valid) {
      console.error(validatePlugin.errors);
    }
    expect(valid).toBe(true);
    expect(json.name).toBe("jp-bids-mcp");
    expect(json.$schema).toBe("https://agent-plugins.org/schemas/1.0.0/plugin.schema.json");

    // Verify root is clean of non-schema properties
    expect((json as Record<string, unknown>).displayName).toBeUndefined();
    expect((json as Record<string, unknown>).skills).toBeUndefined();
    expect((json as Record<string, unknown>).mcpServers).toBeUndefined();

    // Verify OpenAI specific extension
    expect(json.extensions?.["com.openai"]?.displayName).toBeDefined();

    // Verify Agent Skill exists in skills directory
    expect(fs.existsSync(SKILL_PATH)).toBe(true);
    const skillContent = fs.readFileSync(SKILL_PATH, "utf8");
    expect(skillContent).toContain("name: jp-bids-procurement-search");
  });

  it("negative test: rejects invalid plugin.json variations", () => {
    // 1. Root displayName is not allowed (additionalProperties: false)
    const withDisplayName = {
      $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
      name: "jp-bids-mcp",
      displayName: "Invalid Root DisplayName",
    };
    expect(validatePlugin(withDisplayName)).toBe(false);

    // 2. Root mcpServers is not allowed in plugin.json
    const withMcpServers = {
      $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
      name: "jp-bids-mcp",
      mcpServers: "./mcp.json",
    };
    expect(validatePlugin(withMcpServers)).toBe(false);

    // 3. Invalid name format (uppercase, special chars, double hyphens)
    const withInvalidName = {
      $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
      name: "JP_Bids_MCP--Invalid",
    };
    expect(validatePlugin(withInvalidName)).toBe(false);
  });

  it("validates mcp.schema.json compliance and rejects legacy/untyped configurations", () => {
    // 1. Valid Streamable HTTP server configuration
    const validHttpConfig = {
      $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
      mcpServers: {
        "jp-bids": {
          type: "streamable-http",
          url: "https://mcp.bid-jp.com/mcp",
        },
      },
    };
    expect(validateMcp(validHttpConfig)).toBe(true);

    // 2. Valid stdio configuration requiring type: 'stdio' and command
    const validStdioConfig = {
      $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
      mcpServers: {
        "jp-bids-mock": {
          type: "stdio",
          command: "node",
          args: ["./server.js"],
        },
      },
    };
    expect(validateMcp(validStdioConfig)).toBe(true);

    // 3. Negative: stdio missing type is rejected
    const missingType = {
      $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
      mcpServers: {
        "jp-bids-mock": {
          command: "node",
          args: ["./server.js"],
        },
      },
    };
    expect(validateMcp(missingType)).toBe(false);

    // 4. Negative: unauthorized additional property (e.g. description) is rejected
    const withDescription = {
      $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
      mcpServers: {
        "jp-bids-mock": {
          type: "stdio",
          command: "node",
          description: "Not allowed in schema",
        },
      },
    };
    expect(validateMcp(withDescription)).toBe(false);
  });

  it("ensures no unverified mcp.json is distributed in plugins/jp-bids-mcp/", () => {
    const distributedMcpJson = path.join(PLUGIN_DIR, "mcp.json");
    expect(fs.existsSync(distributedMcpJson)).toBe(false);
  });

  it("simulates plugin installation in an isolated cache directory and verifies self-containment", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-plugin-cache-"));
    try {
      // Copy only plugins/jp-bids-mcp/ contents to the isolated cache directory
      fs.cpSync(PLUGIN_DIR, tempDir, { recursive: true });

      // In the isolated directory, plugin.json and skills/ must exist
      const cachedPluginJson = path.join(tempDir, "plugin.json");
      const cachedSkillPath = path.join(tempDir, "skills", "search-bids", "SKILL.md");

      expect(fs.existsSync(cachedPluginJson)).toBe(true);
      expect(fs.existsSync(cachedSkillPath)).toBe(true);

      const skillContent = fs.readFileSync(cachedSkillPath, "utf8");
      expect(skillContent).toContain("name: jp-bids-procurement-search");

      // Verify that the skill explicitly mentions mode differentiation
      expect(skillContent).toContain("モード A");
      expect(skillContent).toContain("モード B");

      // Verify the cached plugin does not contain broken relative references to outer repository
      const pluginManifest = JSON.parse(fs.readFileSync(cachedPluginJson, "utf8"));
      expect(pluginManifest.mcpServers).toBeUndefined();
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("ensures no absolute user paths or secrets are leaked in manifests", () => {
    const filesToCheck = [MARKETPLACE_PATH, PLUGIN_PATH];

    for (const filePath of filesToCheck) {
      const content = fs.readFileSync(filePath, "utf8");

      // Check for absolute local paths
      expect(content).not.toMatch(/[a-zA-Z]:\\[Uu]sers\\/);
      expect(content).not.toMatch(/\/home\//);
      expect(content).not.toMatch(/\/Users\//);

      // Check for exposed tokens or keys
      expect(content).not.toMatch(/sk-[a-zA-Z0-9_-]{20,}/);
      expect(content).not.toMatch(/bearer\s+/i);
    }
  });
});
