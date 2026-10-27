#!/usr/bin/env node
import { discoverAll, listSkillsIn, listCommandsIn } from "./discover.js";
import { diagnose, formatIssues } from "./doctor.js";
import { checkEnvironment } from "./environment.js";
import { openEditor } from "./editor.js";
import { launch } from "./launch.js";
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
