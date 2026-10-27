import { discoverAll, skillExists, commandExists } from "./discover.js";
import type { DoctorIssue, Preset } from "./types.js";

/**
 * Static validation: every referenced server, skill, and command must resolve
 * to something on disk. This catches the common failure where a preset still
 * names a server that was removed from the Claude config — Claude Code itself
 * stays silent about those.
 */
export function diagnose(preset: Preset, cwd = process.cwd()): DoctorIssue[] {
  const issues: DoctorIssue[] = [];
  const { mcpServers, plugins } = discoverAll(cwd);

  const servers = preset.enabledMcpjsonServers ?? [];
  const skills = preset.enabledSkills ?? [];
  const commands = preset.enabledCommands ?? [];

  for (const alias of servers) {
    if (!mcpServers.has(alias)) {
      issues.push({
        level: "error",
        message: `MCP server '${alias}' has no definition in any known config — it will be skipped at launch.`,
      });
    }
  }

  for (const id of preset.enabledPlugins ?? []) {
    if (!plugins.includes(id)) {
      issues.push({
        level: "warn",
        message: `Plugin '${id}' is not listed in enabledPlugins of ~/.claude/settings.json.`,
      });
    }
  }

  for (const skill of skills) {
    if (!skillExists(skill)) {
      issues.push({
        level: "error",
        message: `Skill '${skill}' not found in ~/.claude/skills/.`,
      });
    }
  }

  for (const command of commands) {
    if (!commandExists(command)) {
      issues.push({
        level: "error",
        message: `Command '${command}' not found in ~/.claude/commands/${command}.md.`,
      });
    }
  }

  if (servers.length === 0 && skills.length === 0 && commands.length === 0) {
    issues.push({
      level: "warn",
      message: "Preset is empty — the session will start with built-in tools only.",
    });
  }

  return issues;
}

export function formatIssues(issues: DoctorIssue[]): string {
  return issues
    .map((i) => `  ${i.level === "error" ? "✗" : "⚠"} ${i.message}`)
    .join("\n");
}
