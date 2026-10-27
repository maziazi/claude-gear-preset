#!/usr/bin/env node
import { discoverAll } from "./discover.js";
import { diagnose, formatIssues } from "./doctor.js";
import { openEditor } from "./editor.js";
import { launch } from "./launch.js";
import { GEAR_DIR, presetPath } from "./paths.js";
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
  ccgear create <name>        Create a preset (opens your editor, pre-filled)
  ccgear edit <name>          Edit an existing preset
  ccgear doctor <name>        Check a preset for missing servers/skills/commands
  ccgear remove <name>        Delete a preset
  ccgear <name> [args...]     Launch Claude Code with that preset

Presets live in ${GEAR_DIR} (override with $CCGEAR_DIR).
Extra args after the preset name are passed straight to claude.`;

function die(message: string): never {
  console.error(message);
  process.exit(1);
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
  const issues = diagnose(preset);
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
      const counts = [
        `${preset.enabledMcpjsonServers?.length ?? 0} MCP`,
        `${preset.enabledSkills?.length ?? 0} skills`,
        `${preset.enabledCommands?.length ?? 0} commands`,
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
  const section = (label: string, items: string[] = []) => {
    console.log(`\n${label} (${items.length}):`);
    if (items.length === 0) console.log("  (none)");
    else for (const item of items) console.log(`  ${item}`);
  };

  console.log(`Preset : ${name}`);
  console.log(`Desc   : ${preset.description || "(none)"}`);
  section("MCP servers", preset.enabledMcpjsonServers);
  section("Plugins", preset.enabledPlugins);
  section("Skills", preset.enabledSkills);
  section("Commands", preset.enabledCommands);
}

function cmdCreate(name: string): void {
  const invalid = validateName(name);
  if (invalid) die(invalid);
  if (presetExists(name)) {
    die(`Preset '${name}' already exists. Edit it with: ccgear edit ${name}`);
  }

  const found = discoverAll();
  const template: Preset = {
    description: "",
    enabledMcpjsonServers: [...found.mcpServers.keys()].sort(),
    enabledPlugins: found.plugins,
    enabledSkills: found.skills,
    enabledCommands: found.commands,
  };

  savePreset(name, template);
  console.log(`Pre-filled '${name}' with everything discovered — remove what you don't need.`);
  editAndValidate(name);
}

function cmdEdit(name: string): void {
  if (!presetExists(name)) notFound(name);
  editAndValidate(name);
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
  removePreset(name);
  console.log(`Removed preset '${name}'.`);
}

function cmdLaunch(name: string, passthrough: string[]): void {
  if (!presetExists(name)) notFound(name);

  let preset: Preset;
  try {
    preset = loadPreset(name);
  } catch (err) {
    die(`Preset '${name}' is not valid JSON: ${(err as Error).message}`);
  }

  const blocking = diagnose(preset).filter((i) => i.level === "error");
  if (blocking.length > 0) {
    console.error(`Starting '${name}' with unresolved entries:`);
    console.error(formatIssues(blocking));
  }

  launch(name, preset, passthrough);
}

function main(argv: string[]): void {
  const [command, ...rest] = argv;

  if (!command || command === "help" || command === "--help" || command === "-h") {
    console.log(HELP);
    return;
  }

  switch (command) {
    case "list":
      return cmdList();
    case "show":
      return cmdShow(requireName(rest, "show"));
    case "create":
      return cmdCreate(requireName(rest, "create"));
    case "edit":
      return cmdEdit(requireName(rest, "edit"));
    case "doctor":
      return cmdDoctor(requireName(rest, "doctor"));
    case "remove":
      return cmdRemove(requireName(rest, "remove"));
    default:
      return cmdLaunch(command, rest);
  }
}

main(process.argv.slice(2));
