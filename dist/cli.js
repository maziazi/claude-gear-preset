#!/usr/bin/env node
import { readFileSync, existsSync, cpSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { discoverAll, discoverMcpServers, listSkillsIn, listCommandsIn, } from "./discover.js";
import { probeAll } from "./probe.js";
import { completionScript, SUPPORTED_SHELLS } from "./completion.js";
import { diagnose, formatIssues } from "./doctor.js";
import { checkEnvironment } from "./environment.js";
import { openEditor } from "./editor.js";
import { launch, parseLaunchArgs } from "./launch.js";
import { fingerprint, isWarmed, markWarmed, forgetWarmed } from "./warmstate.js";
import { askText, multiSelect, selectOne, isInteractive } from "./prompt.js";
import { validateSlug, parsePairs, buildStdioServer, buildHttpServer, scaffoldSkill, scaffoldCommand, } from "./add.js";
import { GEAR_DIR, presetPath, presetAssetsDir, presetSkillsDir, presetCommandsDir, } from "./paths.js";
import { listPresets, loadPreset, presetExists, removePreset, savePreset, validateName, } from "./preset.js";
const HELP = `ccgear - bundle MCP servers, skills, and slash commands into named presets

Usage:
  ccgear list                 List presets
  ccgear show <name>          Show a preset's contents
  ccgear create <name>        Create a preset (interactive; --editor for raw JSON)
  ccgear add <name>           Add a new MCP server, skill, or command to a preset
  ccgear clone <from> <to>    Copy a preset, bundled assets included
  ccgear edit <name>          Edit a preset (interactive; --editor for raw JSON)
  ccgear doctor <name>        Check a preset (--deep also connects to each server)
  ccgear remove <name>        Delete a preset
  ccgear version              Print the installed version
  ccgear completion <shell>   Print a completion script (bash, zsh, fish)
  ccgear <name> [args...]     Launch Claude Code with that preset

Servers are connected to once, the first time a preset uses them, so the
session does not start before they are ready. Force it with --warm, or skip
it with --no-warm.

Presets live in ${GEAR_DIR} (override with $CCGEAR_DIR).
Extra args after the preset name are passed straight to claude.`;
function die(message) {
    console.error(message);
    process.exit(1);
}
function readVersion() {
    try {
        const path = fileURLToPath(new URL("../package.json", import.meta.url));
        return JSON.parse(readFileSync(path, "utf8")).version ?? "unknown";
    }
    catch {
        return "unknown";
    }
}
function requireName(args, subcommand) {
    const name = args[0];
    if (!name)
        die(`Usage: ccgear ${subcommand} <name>`);
    return name;
}
function notFound(name) {
    const presets = listPresets();
    const hint = presets.length
        ? `Available: ${presets.join(", ")}`
        : "No presets yet. Create one with: ccgear create <name>";
    die(`Preset '${name}' not found.\n${hint}`);
}
function reportDiagnosis(name, preset) {
    const issues = [...checkEnvironment(), ...diagnose(preset, name)];
    if (issues.length === 0) {
        console.log("✔ No issues found.");
        return;
    }
    const errors = issues.filter((i) => i.level === "error").length;
    console.log(`${errors > 0 ? "✗" : "⚠"} ${name}:`);
    console.log(formatIssues(issues));
}
function cmdList(namesOnly) {
    const presets = listPresets();
    // Bare names feed shell completion, where any decoration would be noise.
    if (namesOnly) {
        for (const name of presets)
            console.log(name);
        return;
    }
    if (presets.length === 0) {
        console.log("No presets yet. Create one with: ccgear create <name>");
        return;
    }
    for (const name of presets) {
        let summary = "";
        try {
            const preset = loadPreset(name);
            const union = (named = [], local = []) => new Set([...named, ...local]).size;
            const counts = [
                `${union(preset.enabledMcpjsonServers, Object.keys(preset.mcpServers ?? {}))} MCP`,
                `${union(preset.enabledSkills, listSkillsIn(presetSkillsDir(name)))} skills`,
                `${union(preset.enabledCommands, listCommandsIn(presetCommandsDir(name)))} commands`,
            ].join(", ");
            summary = preset.description ? `${preset.description} (${counts})` : `(${counts})`;
        }
        catch {
            summary = "(unreadable — invalid JSON)";
        }
        console.log(`  ${name.padEnd(16)} ${summary}`);
    }
}
function cmdShow(name) {
    if (!presetExists(name))
        notFound(name);
    const preset = loadPreset(name);
    const localSkills = listSkillsIn(presetSkillsDir(name));
    const localCommands = listCommandsIn(presetCommandsDir(name));
    const section = (label, items = [], owned = []) => {
        const all = [
            ...items.filter((i) => !owned.includes(i)).map((i) => i),
            ...owned.map((i) => `${i}  (bundled)`),
        ];
        console.log(`\n${label} (${all.length}):`);
        if (all.length === 0)
            console.log("  (none)");
        else
            for (const item of all)
                console.log(`  ${item}`);
    };
    console.log(`Preset : ${name}`);
    console.log(`Desc   : ${preset.description || "(none)"}`);
    console.log(`Assets : ${presetAssetsDir(name)}`);
    section("MCP servers", preset.enabledMcpjsonServers, Object.keys(preset.mcpServers ?? {}));
    section("Plugins", preset.enabledPlugins);
    section("Skills", preset.enabledSkills, localSkills);
    section("Commands", preset.enabledCommands, localCommands);
    console.log("\n(bundled) entries travel with the preset — no global install needed.");
}
/**
 * Walk through the discovered tools as checkbox lists.
 *
 * Nothing starts selected: picking the handful a context needs is less work
 * than unpicking everything it does not.
 */
async function buildInteractively(current) {
    const found = discoverAll();
    const description = await askText(`Description${current.description ? ` [${current.description}]` : ""}:`, { fallback: current.description ?? "" });
    const enabledMcpjsonServers = await multiSelect({
        title: "MCP servers",
        choices: [...found.mcpServers.keys()].sort(),
        selected: current.enabledMcpjsonServers,
    });
    const enabledPlugins = await multiSelect({
        title: "Plugins",
        choices: found.plugins,
        selected: current.enabledPlugins,
    });
    const enabledSkills = await multiSelect({
        title: "Skills",
        choices: found.skills,
        selected: current.enabledSkills,
    });
    const enabledCommands = await multiSelect({
        title: "Slash commands",
        choices: found.commands,
        selected: current.enabledCommands,
    });
    return {
        description,
        // Inline definitions are not part of the checkbox lists, so carry them
        // through untouched rather than dropping them on edit.
        ...(current.mcpServers ? { mcpServers: current.mcpServers } : {}),
        enabledMcpjsonServers,
        enabledPlugins,
        enabledSkills,
        enabledCommands,
    };
}
async function cmdCreate(name, useEditor) {
    const invalid = validateName(name);
    if (invalid)
        die(invalid);
    if (presetExists(name)) {
        die(`Preset '${name}' already exists. Edit it with: ccgear edit ${name}`);
    }
    if (useEditor || !isInteractive()) {
        const found = discoverAll();
        savePreset(name, {
            description: "",
            enabledMcpjsonServers: [...found.mcpServers.keys()].sort(),
            enabledPlugins: found.plugins,
            enabledSkills: found.skills,
            enabledCommands: found.commands,
        });
        console.log(`Pre-filled '${name}' with everything discovered — remove what you don't need.`);
        editAndValidate(name);
        return;
    }
    const preset = await buildInteractively({});
    savePreset(name, preset);
    console.log(`\nSaved to ${presetPath(name)}`);
    reportDiagnosis(name, preset);
    console.log(`\nLaunch it with: ccgear ${name}`);
}
async function addServer(name, preset) {
    const alias = await askText("Server name (as Claude will see it):");
    const slugIssue = validateSlug(alias);
    if (slugIssue)
        die(slugIssue);
    if (preset.mcpServers?.[alias] || preset.enabledMcpjsonServers?.includes(alias)) {
        die(`'${alias}' is already in this preset.`);
    }
    const transport = await selectOne({
        title: "How does it run?",
        choices: ["stdio — a local command", "http — a remote endpoint"],
    });
    let definition;
    if (transport.startsWith("stdio")) {
        const command = await askText("Command (e.g. npx):");
        if (!command.trim())
            die("A stdio server needs a command.");
        const args = await askText("Arguments (space separated, blank for none):");
        const env = await askText("Env vars as KEY=value, comma separated (blank for none):");
        if (parsePairs(env) === null)
            die("Could not read those env vars. Use KEY=value,KEY2=value2.");
        definition = buildStdioServer({ command, args, env });
    }
    else {
        const url = await askText("URL:");
        if (!url.trim())
            die("An http server needs a URL.");
        const headers = await askText("Headers as Key=value, comma separated (blank for none):");
        if (parsePairs(headers) === null)
            die("Could not read those headers. Use Key=value,Key2=value2.");
        definition = buildHttpServer({ url, headers });
    }
    // Stored inline so the server travels with the preset.
    preset.mcpServers = { ...preset.mcpServers, [alias]: definition };
    savePreset(name, preset);
    console.log(`\nAdded '${alias}' to '${name}'.`);
    console.log("Connecting to check it works…");
    const [result] = await probeAll(new Map([[alias, definition]]));
    const mark = { ok: "✔", auth: "!", failed: "✗" };
    console.log(`  ${mark[result.status]} ${result.name}: ${result.detail}`);
    if (result.status === "failed") {
        console.log(`Fix it with: ccgear edit ${name} --editor`);
    }
}
async function addSkill(name) {
    const slug = await askText("Skill name (lowercase-with-dashes):");
    const slugIssue = validateSlug(slug);
    if (slugIssue)
        die(slugIssue);
    const description = await askText("One line on when Claude should use it:");
    const { path, created } = scaffoldSkill(name, slug, description);
    if (!created)
        die(`Skill '${slug}' already exists in this preset:\n  ${path}`);
    console.log(`\nCreated ${path}`);
    if (isInteractive())
        openEditor(path);
    console.log(`'${slug}' is bundled with '${name}' — no global install needed.`);
}
async function addCommand(name) {
    const slug = await askText("Command name (used as /name):");
    const slugIssue = validateSlug(slug);
    if (slugIssue)
        die(slugIssue);
    const description = await askText("One line on what it does:");
    const { path, created } = scaffoldCommand(name, slug, description);
    if (!created)
        die(`Command '${slug}' already exists in this preset:\n  ${path}`);
    console.log(`\nCreated ${path}`);
    if (isInteractive())
        openEditor(path);
    console.log(`/${slug} is bundled with '${name}' — no global install needed.`);
}
async function cmdAdd(name, kind) {
    if (!presetExists(name))
        notFound(name);
    if (!isInteractive() && !kind) {
        die("Adding needs a terminal, or pass --server, --skill, or --command.");
    }
    const preset = loadPreset(name);
    const chosen = kind ??
        (await selectOne({
            title: `Add to '${name}':`,
            choices: ["MCP server", "Skill", "Slash command"],
        }));
    if (chosen === "--server" || chosen === "MCP server")
        return addServer(name, preset);
    if (chosen === "--skill" || chosen === "Skill")
        return addSkill(name);
    if (chosen === "--command" || chosen === "Slash command")
        return addCommand(name);
    die(`Unknown kind '${chosen}'. Use --server, --skill, or --command.`);
}
function cmdClone(from, to) {
    if (!presetExists(from))
        notFound(from);
    const invalid = validateName(to);
    if (invalid)
        die(invalid);
    if (presetExists(to)) {
        die(`Preset '${to}' already exists. Pick another name or remove it first.`);
    }
    savePreset(to, loadPreset(from));
    // Bundled assets belong to the preset, so a copy is only a copy with them.
    const assets = presetAssetsDir(from);
    if (existsSync(assets)) {
        cpSync(assets, presetAssetsDir(to), { recursive: true, dereference: true });
        console.log(`Copied bundled assets to ${presetAssetsDir(to)}`);
    }
    console.log(`Cloned '${from}' to '${to}'. Edit it with: ccgear edit ${to}`);
}
function cmdCompletion(shell) {
    if (!shell || !SUPPORTED_SHELLS.includes(shell)) {
        die(`Usage: ccgear completion <${SUPPORTED_SHELLS.join("|")}>`);
    }
    console.log(completionScript(shell));
}
async function cmdEdit(name, useEditor) {
    if (!presetExists(name))
        notFound(name);
    if (useEditor || !isInteractive()) {
        editAndValidate(name);
        return;
    }
    const preset = await buildInteractively(loadPreset(name));
    savePreset(name, preset);
    console.log(`\nSaved to ${presetPath(name)}`);
    reportDiagnosis(name, preset);
}
function editAndValidate(name) {
    openEditor(presetPath(name));
    let preset;
    try {
        preset = loadPreset(name);
    }
    catch (err) {
        die(`Saved, but '${name}' is not valid JSON: ${err.message}\n` +
            `Fix it with: ccgear edit ${name}`);
    }
    console.log(`Saved to ${presetPath(name)}`);
    reportDiagnosis(name, preset);
}
async function cmdDoctor(name, deep) {
    if (!presetExists(name))
        notFound(name);
    const preset = loadPreset(name);
    reportDiagnosis(name, preset);
    if (!deep)
        return;
    const servers = resolveServers(preset);
    if (servers.size === 0) {
        console.log("\nNo MCP servers to connect to.");
        return;
    }
    console.log(`\nConnecting to ${servers.size} server(s)…`);
    const results = await probeAll(servers);
    const mark = { ok: "✔", auth: "!", failed: "✗" };
    for (const result of results.sort((a, b) => a.name.localeCompare(b.name))) {
        console.log(`  ${mark[result.status]} ${result.name}: ${result.detail}`);
    }
    if (results.some((r) => r.status === "failed"))
        process.exitCode = 1;
}
function cmdRemove(name) {
    if (!presetExists(name))
        notFound(name);
    const bundled = listSkillsIn(presetSkillsDir(name)).length +
        listCommandsIn(presetCommandsDir(name)).length;
    removePreset(name);
    forgetWarmed(name);
    console.log(`Removed preset '${name}'.`);
    // Bundled assets are hand-written files; deleting them silently would throw
    // away work the preset file does not contain.
    if (bundled > 0) {
        console.log(`Kept ${bundled} bundled asset(s) in ${presetAssetsDir(name)} — delete that folder yourself if you no longer need them.`);
    }
}
/**
 * Resolve a preset's servers the same way a launch does.
 *
 * Shared with `doctor --deep` so what gets probed is what would connect.
 */
function resolveServers(preset) {
    const discovered = discoverMcpServers();
    const servers = new Map();
    for (const alias of preset.enabledMcpjsonServers ?? []) {
        const def = discovered.get(alias);
        if (def)
            servers.set(alias, def);
    }
    for (const [alias, def] of Object.entries(preset.mcpServers ?? {})) {
        servers.set(alias, def);
    }
    return servers;
}
async function cmdLaunch(name, passthrough, warm) {
    if (!presetExists(name))
        notFound(name);
    let preset;
    try {
        preset = loadPreset(name);
    }
    catch (err) {
        die(`Preset '${name}' is not valid JSON: ${err.message}`);
    }
    const blocking = diagnose(preset, name).filter((i) => i.level === "error");
    if (blocking.length > 0) {
        console.error(`Starting '${name}' with unresolved entries:`);
        console.error(formatIssues(blocking));
    }
    const servers = resolveServers(preset);
    const print = fingerprint(servers);
    // Claude Code connects to MCP servers in the background and answers the
    // first prompt without waiting, so a server still downloading its package
    // can miss the session entirely. Warming pays that cost up front, where it
    // is visible, instead of silently losing tools.
    //
    // Doing it automatically the first time a given set of servers is used, and
    // never again, keeps the slow case correct without taxing every launch.
    const shouldWarm = warm === "always" ||
        (warm === "auto" && servers.size > 0 && !isWarmed(name, print));
    if (shouldWarm && servers.size > 0) {
        console.log(`Warming ${servers.size} server(s)…`);
        const results = await probeAll(servers);
        const mark = { ok: "✔", auth: "!", failed: "✗" };
        for (const result of results.sort((a, b) => a.name.localeCompare(b.name))) {
            if (result.status !== "ok") {
                console.log(`  ${mark[result.status]} ${result.name}: ${result.detail}`);
            }
        }
        // Recorded even when a server failed: retrying on every launch would
        // punish the whole session for one endpoint being down.
        markWarmed(name, print);
    }
    launch(name, preset, passthrough);
}
async function main(argv) {
    const [command, ...rest] = argv;
    if (!command || command === "help" || command === "--help" || command === "-h") {
        console.log(HELP);
        return;
    }
    if (command === "version" || command === "--version" || command === "-v") {
        console.log(readVersion());
        return;
    }
    const useEditor = rest.includes("--editor");
    const deep = rest.includes("--deep");
    const args = rest.filter((arg) => !["--editor", "--deep", "--names", "--server", "--skill", "--command"].includes(arg));
    switch (command) {
        case "list":
            return cmdList(rest.includes("--names"));
        case "show":
            return cmdShow(requireName(args, "show"));
        case "create":
            return cmdCreate(requireName(args, "create"), useEditor);
        case "add": {
            const target = requireName(args, "add");
            const kind = rest.find((a) => ["--server", "--skill", "--command"].includes(a));
            return cmdAdd(target, kind);
        }
        case "clone": {
            const from = requireName(args, "clone <from> <to>");
            const to = args[1];
            if (!to)
                die("Usage: ccgear clone <from> <to>");
            return cmdClone(from, to);
        }
        case "completion":
            return cmdCompletion(args[0]);
        case "edit":
            return cmdEdit(requireName(args, "edit"), useEditor);
        case "doctor":
            return cmdDoctor(requireName(args, "doctor"), deep);
        case "remove":
            return cmdRemove(requireName(args, "remove"));
        default: {
            // Everything ccgear does not claim for itself belongs to claude.
            const { passthrough, warm } = parseLaunchArgs(rest);
            return cmdLaunch(command, passthrough, warm);
        }
    }
}
main(process.argv.slice(2)).catch((err) => {
    die(err instanceof Error ? err.message : String(err));
});
