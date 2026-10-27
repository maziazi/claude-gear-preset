import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, parse, dirname } from "node:path";
import {
  CLAUDE_JSON,
  CLAUDE_SETTINGS,
  USER_SKILLS_DIR,
  USER_COMMANDS_DIR,
  PLUGIN_CACHE_DIR,
  PLUGIN_MARKETPLACES_DIR,
} from "./paths.js";
import type { Discovered, McpServerDefinition } from "./types.js";

function readJson(path: string): Record<string, any> | null {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function listDirs(path: string): string[] {
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter((e) => e.isDirectory() || e.isSymbolicLink())
      .map((e) => e.name)
      .filter((n) => !n.startsWith("."));
  } catch {
    return [];
  }
}

/** Every .mcp.json worth reading: cwd→root walk, then plugin cache and marketplaces. */
function mcpJsonPaths(cwd: string): string[] {
  const paths: string[] = [];

  let dir = cwd;
  while (true) {
    const candidate = join(dir, ".mcp.json");
    if (existsSync(candidate)) paths.push(candidate);
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // ~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/.mcp.json
  for (const marketplace of listDirs(PLUGIN_CACHE_DIR)) {
    for (const plugin of listDirs(join(PLUGIN_CACHE_DIR, marketplace))) {
      for (const version of listDirs(join(PLUGIN_CACHE_DIR, marketplace, plugin))) {
        const candidate = join(PLUGIN_CACHE_DIR, marketplace, plugin, version, ".mcp.json");
        if (existsSync(candidate)) paths.push(candidate);
      }
    }
  }

  // ~/.claude/plugins/marketplaces/<marketplace>/external_plugins/<plugin>/.mcp.json
  for (const marketplace of listDirs(PLUGIN_MARKETPLACES_DIR)) {
    const externals = join(PLUGIN_MARKETPLACES_DIR, marketplace, "external_plugins");
    for (const plugin of listDirs(externals)) {
      const candidate = join(externals, plugin, ".mcp.json");
      if (existsSync(candidate)) paths.push(candidate);
    }
  }

  return paths;
}

/**
 * Collect MCP server definitions from every known source.
 * Earlier sources win so the user-scope registry stays authoritative.
 */
export function discoverMcpServers(cwd = process.cwd()): Map<string, McpServerDefinition> {
  const found = new Map<string, McpServerDefinition>();

  const add = (servers: unknown) => {
    if (!servers || typeof servers !== "object") return;
    for (const [name, def] of Object.entries(servers as Record<string, unknown>)) {
      if (!found.has(name) && def && typeof def === "object") {
        found.set(name, def as McpServerDefinition);
      }
    }
  };

  add(readJson(CLAUDE_JSON)?.mcpServers);
  add(readJson(CLAUDE_SETTINGS)?.mcpServers);
  for (const path of mcpJsonPaths(cwd)) {
    add(readJson(path)?.mcpServers);
  }

  return found;
}

function discoverPlugins(): string[] {
  const enabled = readJson(CLAUDE_SETTINGS)?.enabledPlugins;
  if (!enabled || typeof enabled !== "object") return [];
  return Object.keys(enabled).sort();
}

/** Skill directory names in any skills folder (symlinks included). */
export function listSkillsIn(dir: string): string[] {
  return listDirs(dir).sort();
}

/** Command names (basename without .md) in any commands folder. */
export function listCommandsIn(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => parse(f).name)
      .sort();
  } catch {
    return [];
  }
}

/** Skill directory names under ~/.claude/skills. */
export function discoverSkills(): string[] {
  return listSkillsIn(USER_SKILLS_DIR);
}

/** Command names under ~/.claude/commands. */
export function discoverCommands(): string[] {
  return listCommandsIn(USER_COMMANDS_DIR);
}

export function discoverAll(cwd = process.cwd()): Discovered {
  return {
    mcpServers: discoverMcpServers(cwd),
    plugins: discoverPlugins(),
    skills: discoverSkills(),
    commands: discoverCommands(),
  };
}

export function skillExists(name: string): boolean {
  const path = join(USER_SKILLS_DIR, name);
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function commandExists(name: string): boolean {
  return existsSync(join(USER_COMMANDS_DIR, `${name}.md`));
}
