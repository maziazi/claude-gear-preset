import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, lstatSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.CCGEAR_DIR = mkdtempSync(join(tmpdir(), "ccgear-test-"));

const { validateName, savePreset, loadPreset, listPresets, removePreset } = await import(
  "../dist/preset.js"
);
const { buildBundle } = await import("../dist/manifest.js");
const { buildArgs } = await import("../dist/launch.js");
const { diagnose } = await import("../dist/doctor.js");
const { validateShape } = await import("../dist/validate.js");

test("validateName rejects reserved subcommands", () => {
  assert.match(validateName("list"), /reserved/);
  assert.match(validateName("doctor"), /reserved/);
  assert.equal(validateName("dev"), null);
});

test("validateName rejects shell-unsafe names", () => {
  assert.match(validateName("../escape"), /Invalid name/);
  assert.match(validateName("has space"), /Invalid name/);
  assert.equal(validateName("my-preset_2"), null);
});

test("presets round-trip through disk", () => {
  const preset = { description: "test", enabledMcpjsonServers: ["alpha"] };
  savePreset("roundtrip", preset);
  assert.deepEqual(loadPreset("roundtrip"), preset);
  assert.ok(listPresets().includes("roundtrip"));
  removePreset("roundtrip");
  assert.ok(!listPresets().includes("roundtrip"));
});

test("buildBundle writes only the servers the preset names", () => {
  const servers = new Map([
    ["keep", { command: "keep-cmd" }],
    ["drop", { command: "drop-cmd" }],
  ]);
  const bundle = buildBundle("t", { enabledMcpjsonServers: ["keep"] }, servers);
  const written = JSON.parse(readFileSync(bundle.mcpConfigPath, "utf8"));

  assert.deepEqual(Object.keys(written.mcpServers), ["keep"]);
  assert.equal(bundle.pluginDir, null, "no skills or commands means no plugin dir");
  bundle.cleanup();
});

test("buildBundle bundles skills and commands into a synthetic plugin", () => {
  const fixture = mkdtempSync(join(tmpdir(), "ccgear-fixture-"));
  const skillsDir = join(fixture, "skills");
  const commandsDir = join(fixture, "commands");
  mkdirSync(join(skillsDir, "my-skill"), { recursive: true });
  mkdirSync(commandsDir, { recursive: true });
  writeFileSync(join(skillsDir, "my-skill", "SKILL.md"), "# skill");
  writeFileSync(join(commandsDir, "my-cmd.md"), "# command");

  const bundle = buildBundle(
    "t",
    { enabledSkills: ["my-skill"], enabledCommands: ["my-cmd"] },
    new Map(),
    { skillsDir, commandsDir },
  );

  assert.ok(bundle.pluginDir, "plugin dir should exist");
  const manifest = JSON.parse(
    readFileSync(join(bundle.pluginDir, ".claude-plugin", "plugin.json"), "utf8"),
  );
  assert.equal(manifest.skills, "./skills/");
  assert.equal(manifest.commands, "./commands/");
  assert.ok(lstatSync(join(bundle.pluginDir, "skills", "my-skill")).isSymbolicLink());
  assert.equal(
    readFileSync(join(bundle.pluginDir, "skills", "my-skill", "SKILL.md"), "utf8"),
    "# skill",
    "symlink should resolve to the real skill content",
  );

  // Claude Code's command loader skips symlinked .md files, so these must be
  // real files or the slash commands silently never appear.
  assert.ok(
    lstatSync(join(bundle.pluginDir, "commands", "my-cmd.md")).isFile(),
    "command files must be copies, not symlinks",
  );
  assert.equal(
    readFileSync(join(bundle.pluginDir, "commands", "my-cmd.md"), "utf8"),
    "# command",
  );

  bundle.cleanup();
  rmSync(fixture, { recursive: true, force: true });
});

test("buildArgs emits the isolation flags Claude Code needs", () => {
  const args = buildArgs(
    "dev",
    { mcpConfigPath: "/tmp/mcp.json", pluginDir: "/tmp/bundle", settingsPath: null },
    ["--model", "haiku"],
  );

  assert.deepEqual(args, [
    "--mcp-config",
    "/tmp/mcp.json",
    "--strict-mcp-config",
    "--setting-sources",
    "project,local",
    "--plugin-dir",
    "/tmp/bundle",
    "-n",
    "dev",
    "--model",
    "haiku",
  ]);
});

test("buildArgs omits optional flags when the preset has none", () => {
  const args = buildArgs(
    "bare",
    { mcpConfigPath: "/tmp/mcp.json", pluginDir: null, settingsPath: null },
    [],
  );
  assert.ok(!args.includes("--plugin-dir"));
  assert.ok(!args.includes("--settings"));
});

test("buildBundle merges inline servers over global aliases", () => {
  const global = new Map([["shared", { command: "global-version" }]]);
  const bundle = buildBundle(
    "t",
    {
      enabledMcpjsonServers: ["shared"],
      mcpServers: {
        shared: { command: "preset-version" },
        "preset-only": { command: "standalone" },
      },
    },
    global,
  );

  const written = JSON.parse(readFileSync(bundle.mcpConfigPath, "utf8"));
  assert.equal(
    written.mcpServers.shared.command,
    "preset-version",
    "a preset's own definition should win over the global one",
  );
  assert.equal(written.mcpServers["preset-only"].command, "standalone");
  bundle.cleanup();
});

test("buildBundle picks up preset-owned skills and commands without a global install", () => {
  const assets = mkdtempSync(join(tmpdir(), "ccgear-assets-"));
  const localSkillsDir = join(assets, "skills");
  const localCommandsDir = join(assets, "commands");
  mkdirSync(join(localSkillsDir, "bundled-skill"), { recursive: true });
  mkdirSync(localCommandsDir, { recursive: true });
  writeFileSync(join(localSkillsDir, "bundled-skill", "SKILL.md"), "# bundled");
  writeFileSync(join(localCommandsDir, "bundled-cmd.md"), "# bundled cmd");

  // Nothing is listed in the preset and no global dirs are provided.
  const bundle = buildBundle("t", {}, new Map(), {
    skillsDir: "/nonexistent-global-skills",
    commandsDir: "/nonexistent-global-commands",
    localSkillsDir,
    localCommandsDir,
  });

  assert.ok(bundle.pluginDir, "bundled assets alone should produce a plugin dir");
  assert.equal(
    readFileSync(join(bundle.pluginDir, "skills", "bundled-skill", "SKILL.md"), "utf8"),
    "# bundled",
  );
  assert.equal(
    readFileSync(join(bundle.pluginDir, "commands", "bundled-cmd.md"), "utf8"),
    "# bundled cmd",
  );

  bundle.cleanup();
  rmSync(assets, { recursive: true, force: true });
});

test("buildBundle prefers a preset-owned skill over a global one of the same name", () => {
  const fixture = mkdtempSync(join(tmpdir(), "ccgear-collide-"));
  const globalSkills = join(fixture, "global");
  const localSkillsDir = join(fixture, "local");
  mkdirSync(join(globalSkills, "shared"), { recursive: true });
  mkdirSync(join(localSkillsDir, "shared"), { recursive: true });
  writeFileSync(join(globalSkills, "shared", "SKILL.md"), "global");
  writeFileSync(join(localSkillsDir, "shared", "SKILL.md"), "local");

  const bundle = buildBundle("t", { enabledSkills: ["shared"] }, new Map(), {
    skillsDir: globalSkills,
    localSkillsDir,
  });

  assert.equal(
    readFileSync(join(bundle.pluginDir, "skills", "shared", "SKILL.md"), "utf8"),
    "local",
  );

  bundle.cleanup();
  rmSync(fixture, { recursive: true, force: true });
});

test("diagnose accepts a preset defined entirely inline", () => {
  const issues = diagnose({
    enabledMcpjsonServers: ["my-api"],
    mcpServers: { "my-api": { command: "npx", args: ["-y", "some-server"] } },
  });
  assert.deepEqual(issues, [], "an inline definition should satisfy the lookup");
});

test("diagnose flags servers that no config defines", () => {
  const issues = diagnose({ enabledMcpjsonServers: ["definitely-not-a-real-server"] });
  assert.ok(
    issues.some(
      (i) => i.level === "error" && i.message.includes("definitely-not-a-real-server"),
    ),
  );
});

test("diagnose catches a misspelled field instead of ignoring it", () => {
  const issues = diagnose({ enabledSkill: ["ios-design"] });
  assert.equal(issues.length, 1);
  assert.match(issues[0].message, /enabledSkill.*did you mean 'enabledSkills'/);
});

test("diagnose rejects a string where an array belongs", () => {
  // Without this check the string is iterated character by character and
  // reported as a dozen missing one-letter servers.
  const issues = diagnose({ enabledMcpjsonServers: "context7" });
  assert.equal(issues.length, 1);
  assert.match(issues[0].message, /must be an array of strings, got string/);
});

test("diagnose rejects a non-object preset", () => {
  assert.match(diagnose([])[0].message, /must be a JSON object/);
  assert.match(diagnose(null)[0].message, /must be a JSON object/);
});

test("diagnose accepts every known field", () => {
  const issues = validateShape({
    description: "ok",
    mcpServers: { a: { command: "x" } },
    enabledMcpjsonServers: [],
    enabledPlugins: [],
    enabledSkills: [],
    enabledCommands: [],
  });
  assert.deepEqual(issues, []);
});

test("diagnose warns about an empty preset", () => {
  const issues = diagnose({});
  assert.ok(issues.some((i) => i.level === "warn" && i.message.includes("empty")));
});

process.on("exit", () => rmSync(process.env.CCGEAR_DIR, { recursive: true, force: true }));
