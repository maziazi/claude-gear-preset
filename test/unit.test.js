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

test("buildBundle symlinks skills and commands into a synthetic plugin", () => {
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
  assert.ok(lstatSync(join(bundle.pluginDir, "commands", "my-cmd.md")).isSymbolicLink());
  assert.equal(
    readFileSync(join(bundle.pluginDir, "skills", "my-skill", "SKILL.md"), "utf8"),
    "# skill",
    "symlink should resolve to the real skill content",
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

test("diagnose flags servers that no config defines", () => {
  const issues = diagnose({ enabledMcpjsonServers: ["definitely-not-a-real-server"] });
  assert.ok(
    issues.some(
      (i) => i.level === "error" && i.message.includes("definitely-not-a-real-server"),
    ),
  );
});

test("diagnose warns about an empty preset", () => {
  const issues = diagnose({});
  assert.ok(issues.some((i) => i.level === "warn" && i.message.includes("empty")));
});

process.on("exit", () => rmSync(process.env.CCGEAR_DIR, { recursive: true, force: true }));
