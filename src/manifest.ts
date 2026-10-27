import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { USER_SKILLS_DIR, USER_COMMANDS_DIR } from "./paths.js";
import type { Preset, McpServerDefinition } from "./types.js";

/**
 * Link `target` into `path`, falling back to a copy.
 *
 * Symlinks keep the bundle cheap and always current, but Windows refuses to
 * create them without Developer Mode or elevation. Copying loses live updates
 * for the duration of one session, which beats failing to start.
 */
function linkOrCopy(target: string, path: string, isDirectory: boolean): void {
  try {
    symlinkSync(target, path, isDirectory ? "junction" : "file");
  } catch {
    cpSync(target, path, { recursive: isDirectory, dereference: true });
  }
}

export interface BuiltBundle {
  /** Temp dir passed to --plugin-dir, or null when the preset has no skills/commands. */
  pluginDir: string | null;
  /** Temp file passed to --mcp-config. */
  mcpConfigPath: string;
  /** Temp file passed to --settings, or null when the preset enables no plugins. */
  settingsPath: string | null;
  cleanup: () => void;
}

/**
 * Materialise a preset into the temp files Claude Code needs.
 *
 * Skills and commands are symlinked rather than copied so edits to the
 * originals are picked up without rebuilding, and large skill folders cost
 * nothing to "include".
 */
export interface BundleSources {
  skillsDir?: string;
  commandsDir?: string;
}

export function buildBundle(
  name: string,
  preset: Preset,
  servers: Map<string, McpServerDefinition>,
  sources: BundleSources = {},
): BuiltBundle {
  const skillsSource = sources.skillsDir ?? USER_SKILLS_DIR;
  const commandsSource = sources.commandsDir ?? USER_COMMANDS_DIR;
  const root = mkdtempSync(join(tmpdir(), `ccgear-${name}-`));

  const mcpServers: Record<string, McpServerDefinition> = {};
  for (const alias of preset.enabledMcpjsonServers ?? []) {
    const def = servers.get(alias);
    if (def) mcpServers[alias] = def;
  }

  const mcpConfigPath = join(root, "mcp-config.json");
  writeFileSync(mcpConfigPath, JSON.stringify({ mcpServers }, null, 2));

  // Plugins are toggled through a settings overlay rather than --plugin-dir,
  // because they are already installed; we only flip them on for this session.
  let settingsPath: string | null = null;
  const pluginIds = preset.enabledPlugins ?? [];
  if (pluginIds.length > 0) {
    const enabledPlugins = Object.fromEntries(pluginIds.map((id) => [id, true]));
    settingsPath = join(root, "settings.json");
    writeFileSync(settingsPath, JSON.stringify({ enabledPlugins }, null, 2));
  }

  const skills = preset.enabledSkills ?? [];
  const commands = preset.enabledCommands ?? [];
  const cleanup = () => rmSync(root, { recursive: true, force: true });

  if (skills.length === 0 && commands.length === 0) {
    return { pluginDir: null, mcpConfigPath, settingsPath, cleanup };
  }

  const pluginDir = join(root, "bundle");
  mkdirSync(join(pluginDir, ".claude-plugin"), { recursive: true });

  const manifest: Record<string, string> = {
    name: `ccgear-${name}`,
    version: "1.0.0",
    description: preset.description || `ccgear preset '${name}'`,
  };

  if (skills.length > 0) {
    const skillsDir = join(pluginDir, "skills");
    mkdirSync(skillsDir, { recursive: true });
    for (const skill of skills) {
      linkOrCopy(join(skillsSource, skill), join(skillsDir, skill), true);
    }
    manifest.skills = "./skills/";
  }

  if (commands.length > 0) {
    const commandsDir = join(pluginDir, "commands");
    mkdirSync(commandsDir, { recursive: true });
    for (const command of commands) {
      linkOrCopy(
        join(commandsSource, `${command}.md`),
        join(commandsDir, `${command}.md`),
        false,
      );
    }
    manifest.commands = "./commands/";
  }

  writeFileSync(
    join(pluginDir, ".claude-plugin", "plugin.json"),
    JSON.stringify(manifest, null, 2),
  );

  return { pluginDir, mcpConfigPath, settingsPath, cleanup };
}
