import { discoverAll, skillExists, commandExists, listSkillsIn, listCommandsIn, } from "./discover.js";
import { presetSkillsDir, presetCommandsDir } from "./paths.js";
import { validateShape } from "./validate.js";
/**
 * Static validation: every referenced server, skill, and command must resolve
 * to something on disk. This catches the common failure where a preset still
 * names a server that was removed from the Claude config — Claude Code itself
 * stays silent about those.
 */
export function diagnose(preset, name, cwd = process.cwd()) {
    // A malformed preset makes every check below meaningless — a string in place
    // of an array would be reported one character at a time — so stop here.
    const shapeIssues = validateShape(preset);
    if (shapeIssues.length > 0)
        return shapeIssues;
    const issues = [];
    const { mcpServers, plugins } = discoverAll(cwd);
    const servers = preset.enabledMcpjsonServers ?? [];
    const inlineServers = Object.keys(preset.mcpServers ?? {});
    const skills = preset.enabledSkills ?? [];
    const commands = preset.enabledCommands ?? [];
    // Preset-owned assets need no global install, so they count towards the
    // "is this preset empty?" check below.
    const localSkills = name ? listSkillsIn(presetSkillsDir(name)) : [];
    const localCommands = name ? listCommandsIn(presetCommandsDir(name)) : [];
    for (const alias of servers) {
        // An inline definition supersedes the global lookup.
        if (preset.mcpServers?.[alias])
            continue;
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
        if (localSkills.includes(skill))
            continue;
        if (!skillExists(skill)) {
            issues.push({
                level: "error",
                message: `Skill '${skill}' not found in ~/.claude/skills/.`,
            });
        }
    }
    for (const command of commands) {
        if (localCommands.includes(command))
            continue;
        if (!commandExists(command)) {
            issues.push({
                level: "error",
                message: `Command '${command}' not found in ~/.claude/commands/${command}.md.`,
            });
        }
    }
    const total = servers.length +
        inlineServers.length +
        skills.length +
        commands.length +
        localSkills.length +
        localCommands.length;
    if (total === 0) {
        issues.push({
            level: "warn",
            message: "Preset is empty — the session will start with built-in tools only.",
        });
    }
    return issues;
}
export function formatIssues(issues) {
    return issues
        .map((i) => `  ${i.level === "error" ? "✗" : "⚠"} ${i.message}`)
        .join("\n");
}
