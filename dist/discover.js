import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, parse, dirname } from "node:path";
import { CLAUDE_JSON, CLAUDE_SETTINGS, USER_SKILLS_DIR, USER_COMMANDS_DIR, PLUGINS_DIR, PLUGIN_CACHE_DIR, PLUGIN_MARKETPLACES_DIR, } from "./paths.js";
function readJson(path) {
    try {
        return JSON.parse(readFileSync(path, "utf8"));
    }
    catch {
        return null;
    }
}
function listDirs(path) {
    try {
        return readdirSync(path, { withFileTypes: true })
            .filter((e) => e.isDirectory() || e.isSymbolicLink())
            .map((e) => e.name)
            .filter((n) => !n.startsWith("."));
    }
    catch {
        return [];
    }
}
/** Every .mcp.json worth reading: cwd→root walk, then plugin cache and marketplaces. */
function mcpJsonPaths(cwd) {
    const paths = [];
    let dir = cwd;
    while (true) {
        const candidate = join(dir, ".mcp.json");
        if (existsSync(candidate))
            paths.push(candidate);
        const parent = dirname(dir);
        if (parent === dir)
            break;
        dir = parent;
    }
    // ~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/.mcp.json
    for (const marketplace of listDirs(PLUGIN_CACHE_DIR)) {
        for (const plugin of listDirs(join(PLUGIN_CACHE_DIR, marketplace))) {
            for (const version of listDirs(join(PLUGIN_CACHE_DIR, marketplace, plugin))) {
                const candidate = join(PLUGIN_CACHE_DIR, marketplace, plugin, version, ".mcp.json");
                if (existsSync(candidate))
                    paths.push(candidate);
            }
        }
    }
    // ~/.claude/plugins/marketplaces/<marketplace>/external_plugins/<plugin>/.mcp.json
    for (const marketplace of listDirs(PLUGIN_MARKETPLACES_DIR)) {
        const externals = join(PLUGIN_MARKETPLACES_DIR, marketplace, "external_plugins");
        for (const plugin of listDirs(externals)) {
            const candidate = join(externals, plugin, ".mcp.json");
            if (existsSync(candidate))
                paths.push(candidate);
        }
    }
    return paths;
}
/**
 * Collect MCP server definitions from every known source.
 * Earlier sources win so the user-scope registry stays authoritative.
 */
export function discoverMcpServers(cwd = process.cwd()) {
    const found = new Map();
    const add = (servers) => {
        if (!servers || typeof servers !== "object")
            return;
        for (const [name, def] of Object.entries(servers)) {
            if (!found.has(name) && def && typeof def === "object") {
                found.set(name, def);
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
function discoverPlugins() {
    const enabled = readJson(CLAUDE_SETTINGS)?.enabledPlugins;
    if (!enabled || typeof enabled !== "object")
        return [];
    return Object.keys(enabled).sort();
}
/** Skill directory names in any skills folder (symlinks included). */
export function listSkillsIn(dir) {
    return listDirs(dir).sort();
}
/** Command names (basename without .md) in any commands folder. */
export function listCommandsIn(dir) {
    try {
        return readdirSync(dir)
            .filter((f) => f.endsWith(".md"))
            .map((f) => parse(f).name)
            .sort();
    }
    catch {
        return [];
    }
}
/** Skill directory names under ~/.claude/skills. */
export function discoverSkills() {
    return listSkillsIn(USER_SKILLS_DIR);
}
/** Command names under ~/.claude/commands. */
export function discoverCommands() {
    return listCommandsIn(USER_COMMANDS_DIR);
}
export function discoverAll(cwd = process.cwd()) {
    return {
        mcpServers: discoverMcpServers(cwd),
        plugins: discoverPlugins(),
        skills: discoverSkills(),
        commands: discoverCommands(),
    };
}
/**
 * Find where an installed plugin lives on disk.
 *
 * `--setting-sources project,local` drops user-scope settings, which is what
 * isolates skills — but it also switches off plugins installed there. Passing
 * the directory to `--plugin-dir` loads the plugin regardless, so a preset can
 * keep terminal integrations working without giving up isolation.
 */
export function resolvePluginDir(id) {
    const installed = readJson(join(PLUGINS_DIR, "installed_plugins.json"));
    const entries = installed?.plugins?.[id];
    if (!Array.isArray(entries))
        return null;
    for (const entry of entries) {
        const path = entry?.installPath;
        if (typeof path === "string" && existsSync(join(path, ".claude-plugin"))) {
            return path;
        }
    }
    return null;
}
/**
 * Does this plugin only wire up the environment?
 *
 * A plugin that ships hooks and nothing else — no skills, commands, agents or
 * MCP servers — cannot add anything to the model's context. Terminal
 * integrations are built this way: they react to session events to draw a tab
 * icon or raise a notification.
 */
export function isEnvironmentPlugin(dir) {
    if (!existsSync(join(dir, "hooks")))
        return false;
    const manifest = readJson(join(dir, ".claude-plugin", "plugin.json")) ?? {};
    const contributes = ["skills", "commands", "agents", "mcpServers", "lspServers"];
    if (contributes.some((key) => manifest[key] !== undefined))
        return false;
    return !["skills", "commands", "agents"].some((sub) => existsSync(join(dir, sub)))
        && !existsSync(join(dir, ".mcp.json"));
}
/**
 * Install directories of enabled plugins that only wire up the environment.
 *
 * These are loaded into every session rather than being chosen per preset:
 * leaving a terminal integration out costs the notification and the tab icon,
 * and including it costs nothing.
 */
export function discoverEnvironmentPlugins() {
    return discoverPlugins()
        .map((id) => ({ id, dir: resolvePluginDir(id) }))
        .filter((entry) => entry.dir !== null)
        .filter((entry) => isEnvironmentPlugin(entry.dir));
}
export function skillExists(name) {
    const path = join(USER_SKILLS_DIR, name);
    try {
        return statSync(path).isDirectory();
    }
    catch {
        return false;
    }
}
export function commandExists(name) {
    return existsSync(join(USER_COMMANDS_DIR, `${name}.md`));
}
