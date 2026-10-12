import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "..");
const MARKETPLACE_PATH = path.join(REPO_ROOT, ".agents", "plugins", "marketplace.json");
const PLUGIN_PATH = path.join(REPO_ROOT, "plugins", "jp-bids-mcp", "plugin.json");
const MCP_CONFIG_PATH = path.join(REPO_ROOT, "plugins", "jp-bids-mcp", "mcp.json");
const SKILL_PATH = path.join(
  REPO_ROOT,
  "plugins",
  "jp-bids-mcp",
  "skills",
  "search-bids",
  "SKILL.md",
);

describe("GitHub Marketplace & Plugin Manifests", () => {
  it("validates .agents/plugins/marketplace.json syntax and structure", () => {
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

  it("validates plugins/jp-bids-mcp/plugin.json syntax and fields", () => {
    expect(fs.existsSync(PLUGIN_PATH)).toBe(true);
    const content = fs.readFileSync(PLUGIN_PATH, "utf8");
    const json = JSON.parse(content);

    expect(json.name).toBe("jp-bids-mcp");
    expect(typeof json.version).toBe("string");
    expect(typeof json.displayName).toBe("string");
    expect(typeof json.description).toBe("string");
    expect(json.skills).toBe("./skills/");
    expect(json.mcpServers).toBe("./mcp.json");

    const pluginDir = path.dirname(PLUGIN_PATH);
    const resolvedSkillsDir = path.resolve(pluginDir, json.skills);
    const resolvedMcpConfig = path.resolve(pluginDir, json.mcpServers);

    expect(fs.existsSync(resolvedSkillsDir)).toBe(true);
    expect(fs.existsSync(resolvedMcpConfig)).toBe(true);
  });

  it("validates plugins/jp-bids-mcp/mcp.json transport and args", () => {
    expect(fs.existsSync(MCP_CONFIG_PATH)).toBe(true);
    const content = fs.readFileSync(MCP_CONFIG_PATH, "utf8");
    const json = JSON.parse(content);

    expect(json.mcpServers).toBeDefined();
    const server = json.mcpServers["jp-bids-mock"];
    expect(server).toBeDefined();
    expect(server.command).toBe("node");
    expect(Array.isArray(server.args)).toBe(true);
    expect(server.args[0]).toBe("examples/mock-stdio-server.mjs");

    const targetScript = path.resolve(REPO_ROOT, server.args[0]);
    expect(fs.existsSync(targetScript)).toBe(true);
  });

  it("ensures no absolute user paths or secrets are leaked in manifests", () => {
    const filesToCheck = [MARKETPLACE_PATH, PLUGIN_PATH, MCP_CONFIG_PATH];

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

  it("validates the Agent Skill markdown file exists with YAML frontmatter", () => {
    expect(fs.existsSync(SKILL_PATH)).toBe(true);
    const content = fs.readFileSync(SKILL_PATH, "utf8");

    expect(content.startsWith("---")).toBe(true);
    expect(content).toContain("name: jp-bids-procurement-search");
    expect(content).toContain("description:");
  });
});
