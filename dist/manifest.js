import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { USER_SKILLS_DIR, USER_COMMANDS_DIR, presetSkillsDir, presetCommandsDir, } from "./paths.js";
import { listSkillsIn, listCommandsIn, resolvePluginDir, discoverEnvironmentPlugins, } from "./discover.js";
/**
 * Link a skill directory into the bundle, falling back to a copy.
 *
 * Symlinks keep the bundle cheap and always current, but Windows refuses to
 * create them without Developer Mode or elevation. Copying loses live updates
 * for the duration of one session, which beats failing to start.
 */
function linkSkill(target, path) {
    try {
        symlinkSync(target, path, "junction");
    }
    catch {
        cpSync(target, path, { recursive: true, dereference: true });
    }
}
/**
 * Copy a command file into the bundle.
 *
 * Claude Code's command loader skips symlinked `.md` files — verified by
 * placing a real file and a symlink in one directory and seeing only the real
 * one load. Bundles are rebuilt per launch, so a copy is never stale.
 */
function copyCommand(target, path) {
    cpSync(target, path, { dereference: true });
}
/**
 * Materialise a preset into the temp files Claude Code needs.
 *
 * Entries come from two places: names referencing globally installed tools,
 * and the preset's own `skills/` and `commands/` folders, which are picked up
 * automatically so a preset works on a machine with nothing installed.
 */
export function buildBundle(name, preset, servers, sources = {}) {
    const skillsSource = sources.skillsDir ?? USER_SKILLS_DIR;
    const commandsSource = sources.commandsDir ?? USER_COMMANDS_DIR;
    const localSkillsSource = sources.localSkillsDir ?? presetSkillsDir(name);
    const localCommandsSource = sources.localCommandsDir ?? presetCommandsDir(name);
    const root = mkdtempSync(join(tmpdir(), `ccgear-${name}-`));
    // Globally installed servers first, then the preset's own definitions, so a
    // preset can override a global alias with its own version.
    const mcpServers = {};
    for (const alias of preset.enabledMcpjsonServers ?? []) {
        const def = servers.get(alias);
        if (def)
            mcpServers[alias] = def;
    }
    Object.assign(mcpServers, preset.mcpServers ?? {});
    const mcpConfigPath = join(root, "mcp-config.json");
    writeFileSync(mcpConfigPath, JSON.stringify({ mcpServers }, null, 2));
    // Environment-only plugins come along whether or not the preset names them,
    // since they add nothing to the context and leaving one out silently costs
    // the terminal its notifications and tab icon.
    const environment = discoverEnvironmentPlugins();
    const pluginIds = [
        ...new Set([...(preset.enabledPlugins ?? []), ...environment.map((p) => p.id)]),
    ];
    // Both halves are needed: --plugin-dir loads a plugin that --setting-sources
    // would otherwise leave behind, and the overlay is what marks it enabled.
    // With only the first, the plugin is present but dormant.
    let settingsPath = null;
    if (pluginIds.length > 0) {
        const enabledPlugins = Object.fromEntries(pluginIds.map((id) => [id, true]));
        settingsPath = join(root, "settings.json");
        writeFileSync(settingsPath, JSON.stringify({ enabledPlugins }, null, 2));
    }
    const extraPluginDirs = [
        ...new Set(pluginIds
            .map((id) => resolvePluginDir(id))
            .filter((dir) => dir !== null)),
    ];
    // Local assets win over global ones of the same name: a preset that ships
    // its own copy of a skill means to use that copy.
    const skillEntries = new Map();
    for (const skill of preset.enabledSkills ?? []) {
        skillEntries.set(skill, join(skillsSource, skill));
    }
    for (const skill of listSkillsIn(localSkillsSource)) {
        skillEntries.set(skill, join(localSkillsSource, skill));
    }
    const commandEntries = new Map();
    for (const command of preset.enabledCommands ?? []) {
        commandEntries.set(command, join(commandsSource, `${command}.md`));
    }
    for (const command of listCommandsIn(localCommandsSource)) {
        commandEntries.set(command, join(localCommandsSource, `${command}.md`));
    }
    const cleanup = () => rmSync(root, { recursive: true, force: true });
    if (skillEntries.size === 0 && commandEntries.size === 0) {
        return { pluginDir: null, extraPluginDirs, mcpConfigPath, settingsPath, cleanup };
    }
    const pluginDir = join(root, "bundle");
    mkdirSync(join(pluginDir, ".claude-plugin"), { recursive: true });
    const manifest = {
        name: `ccgear-${name}`,
        version: "1.0.0",
        description: preset.description || `ccgear preset '${name}'`,
    };
    if (skillEntries.size > 0) {
        const skillsDir = join(pluginDir, "skills");
        mkdirSync(skillsDir, { recursive: true });
        for (const [skill, source] of skillEntries) {
            linkSkill(source, join(skillsDir, skill));
        }
        manifest.skills = "./skills/";
    }
    if (commandEntries.size > 0) {
        const commandsDir = join(pluginDir, "commands");
        mkdirSync(commandsDir, { recursive: true });
        for (const [command, source] of commandEntries) {
            copyCommand(source, join(commandsDir, `${command}.md`));
        }
        manifest.commands = "./commands/";
    }
    writeFileSync(join(pluginDir, ".claude-plugin", "plugin.json"), JSON.stringify(manifest, null, 2));
    return { pluginDir, extraPluginDirs, mcpConfigPath, settingsPath, cleanup };
}
