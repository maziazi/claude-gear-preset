#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { discoverAll, listSkillsIn, listCommandsIn } from "./discover.js";
import { diagnose, formatIssues } from "./doctor.js";
import { checkEnvironment } from "./environment.js";
import { openEditor } from "./editor.js";
import { launch } from "./launch.js";
import { askText, multiSelect, isInteractive } from "./prompt.js";
import {
  GEAR_DIR,
  presetPath,
  presetAssetsDir,
  presetSkillsDir,
  presetCommandsDir,
} from "./paths.js";
import {
  listPresets,
  loadPreset,
  presetExists,
  removePreset,
  savePreset,
  validateName,
} from "./preset.js";
import type { Preset } from "./types.js";

const HELP = `ccgear - bundle MCP servers, skills, and slash commands into named presets

Usage:
  ccgear list                 List presets
  ccgear show <name>          Show a preset's contents
  ccgear create <name>        Create a preset (interactive; --editor for raw JSON)
  ccgear edit <name>          Edit a preset (interactive; --editor for raw JSON)
  ccgear doctor <name>        Check a preset for missing servers/skills/commands
  ccgear remove <name>        Delete a preset
  ccgear version              Print the installed version
  ccgear <name> [args...]     Launch Claude Code with that preset

Presets live in ${GEAR_DIR} (override with $CCGEAR_DIR).
Extra args after the preset name are passed straight to claude.`;

function die(message: string): never {
  console.error(message);
  process.exit(1);
}

function readVersion(): string {
  try {
    const path = fileURLToPath(new URL("../package.json", import.meta.url));
    return JSON.parse(readFileSync(path, "utf8")).version ?? "unknown";
  } catch {
    return "unknown";
  }
}

function requireName(args: string[], subcommand: string): string {
  const name = args[0];
  if (!name) die(`Usage: ccgear ${subcommand} <name>`);
  return name;
}

function notFound(name: string): never {
  const presets = listPresets();
  const hint = presets.length
    ? `Available: ${presets.join(", ")}`
    : "No presets yet. Create one with: ccgear create <name>";
  die(`Preset '${name}' not found.\n${hint}`);
}

function reportDiagnosis(name: string, preset: Preset): void {
  const issues = [...checkEnvironment(), ...diagnose(preset, name)];
  if (issues.length === 0) {
    console.log("✔ No issues found.");
    return;
  }
  const errors = issues.filter((i) => i.level === "error").length;
  console.log(`${errors > 0 ? "✗" : "⚠"} ${name}:`);
  console.log(formatIssues(issues));
}

function cmdList(): void {
  const presets = listPresets();
  if (presets.length === 0) {
    console.log("No presets yet. Create one with: ccgear create <name>");
    return;
  }
  for (const name of presets) {
    let summary = "";
    try {
      const preset = loadPreset(name);
      const union = (named: string[] = [], local: string[] = []) =>
        new Set([...named, ...local]).size;

      const counts = [
        `${union(preset.enabledMcpjsonServers, Object.keys(preset.mcpServers ?? {}))} MCP`,
        `${union(preset.enabledSkills, listSkillsIn(presetSkillsDir(name)))} skills`,
        `${union(preset.enabledCommands, listCommandsIn(presetCommandsDir(name)))} commands`,
      ].join(", ");
      summary = preset.description ? `${preset.description} (${counts})` : `(${counts})`;
    } catch {
      summary = "(unreadable — invalid JSON)";
    }
    console.log(`  ${name.padEnd(16)} ${summary}`);
  }
}

function cmdShow(name: string): void {
  if (!presetExists(name)) notFound(name);
  const preset = loadPreset(name);
  const localSkills = listSkillsIn(presetSkillsDir(name));
  const localCommands = listCommandsIn(presetCommandsDir(name));

  const section = (label: string, items: string[] = [], owned: string[] = []) => {
    const all = [
      ...items.filter((i) => !owned.includes(i)).map((i) => i),
      ...owned.map((i) => `${i}  (bundled)`),
    ];
    console.log(`\n${label} (${all.length}):`);
    if (all.length === 0) console.log("  (none)");
    else for (const item of all) console.log(`  ${item}`);
  };

  console.log(`Preset : ${name}`);
  console.log(`Desc   : ${preset.description || "(none)"}`);
  console.log(`Assets : ${presetAssetsDir(name)}`);
  section(
    "MCP servers",
    preset.enabledMcpjsonServers,
    Object.keys(preset.mcpServers ?? {}),
  );
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
async function buildInteractively(current: Preset): Promise<Preset> {
  const found = discoverAll();

  const description = await askText(
    `Description${current.description ? ` [${current.description}]` : ""}:`,
    { fallback: current.description ?? "" },
  );

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

async function cmdCreate(name: string, useEditor: boolean): Promise<void> {
  const invalid = validateName(name);
  if (invalid) die(invalid);
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
    console.log(
      `Pre-filled '${name}' with everything discovered — remove what you don't need.`,
    );
    editAndValidate(name);
    return;
  }

  const preset = await buildInteractively({});
  savePreset(name, preset);
  console.log(`\nSaved to ${presetPath(name)}`);
  reportDiagnosis(name, preset);
  console.log(`\nLaunch it with: ccgear ${name}`);
}

async function cmdEdit(name: string, useEditor: boolean): Promise<void> {
  if (!presetExists(name)) notFound(name);

  if (useEditor || !isInteractive()) {
    editAndValidate(name);
    return;
  }

  const preset = await buildInteractively(loadPreset(name));
  savePreset(name, preset);
  console.log(`\nSaved to ${presetPath(name)}`);
  reportDiagnosis(name, preset);
}

function editAndValidate(name: string): void {
  openEditor(presetPath(name));

  let preset: Preset;
  try {
    preset = loadPreset(name);
  } catch (err) {
    die(
      `Saved, but '${name}' is not valid JSON: ${(err as Error).message}\n` +
        `Fix it with: ccgear edit ${name}`,
    );
  }

  console.log(`Saved to ${presetPath(name)}`);
  reportDiagnosis(name, preset);
}

function cmdDoctor(name: string): void {
  if (!presetExists(name)) notFound(name);
  reportDiagnosis(name, loadPreset(name));
}

function cmdRemove(name: string): void {
  if (!presetExists(name)) notFound(name);

  const bundled =
    listSkillsIn(presetSkillsDir(name)).length +
    listCommandsIn(presetCommandsDir(name)).length;

  removePreset(name);
  console.log(`Removed preset '${name}'.`);

  // Bundled assets are hand-written files; deleting them silently would throw
  // away work the preset file does not contain.
  if (bundled > 0) {
    console.log(
      `Kept ${bundled} bundled asset(s) in ${presetAssetsDir(name)} — delete that folder yourself if you no longer need them.`,
    );
  }
}

function cmdLaunch(name: string, passthrough: string[]): void {
  if (!presetExists(name)) notFound(name);

  let preset: Preset;
  try {
    preset = loadPreset(name);
  } catch (err) {
    die(`Preset '${name}' is not valid JSON: ${(err as Error).message}`);
  }

  const blocking = diagnose(preset, name).filter((i) => i.level === "error");
  if (blocking.length > 0) {
    console.error(`Starting '${name}' with unresolved entries:`);
    console.error(formatIssues(blocking));
  }

  launch(name, preset, passthrough);
}

async function main(argv: string[]): Promise<void> {
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
  const args = rest.filter((arg) => arg !== "--editor");

  switch (command) {
    case "list":
      return cmdList();
    case "show":
      return cmdShow(requireName(args, "show"));
    case "create":
      return cmdCreate(requireName(args, "create"), useEditor);
    case "edit":
      return cmdEdit(requireName(args, "edit"), useEditor);
    case "doctor":
      return cmdDoctor(requireName(args, "doctor"));
    case "remove":
      return cmdRemove(requireName(args, "remove"));
    default:
      // Everything after the preset name belongs to claude, --editor included.
      return cmdLaunch(command, rest);
  }
}

main(process.argv.slice(2)).catch((err: unknown) => {
  die(err instanceof Error ? err.message : String(err));
});
