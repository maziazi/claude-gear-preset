import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, lstatSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as eventsModule from "node:events";

process.env.CCGEAR_DIR = mkdtempSync(join(tmpdir(), "ccgear-test-"));

const { validateName, savePreset, loadPreset, listPresets, removePreset } = await import(
  "../dist/preset.js"
);
const { buildBundle } = await import("../dist/manifest.js");
const { buildArgs, parseLaunchArgs } = await import("../dist/launch.js");
const { diagnose } = await import("../dist/doctor.js");
const { validateShape } = await import("../dist/validate.js");
const { multiSelect, askText, parseKeys } = await import("../dist/prompt.js");
const { completionScript, SUPPORTED_SHELLS } = await import("../dist/completion.js");

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

test("loadPreset names the preset and file when the JSON is broken", () => {
  // A bare parser error gives no clue which preset is at fault.
  writeFileSync(join(process.env.CCGEAR_DIR, "broken.json"), '{"a":1,}');
  assert.throws(() => loadPreset("broken"), (err) => {
    assert.match(err.message, /Preset 'broken' is not valid JSON/);
    assert.match(err.message, /broken\.json/);
    return true;
  });
});

test("loadPreset rejects a JSON value that is not an object", () => {
  writeFileSync(join(process.env.CCGEAR_DIR, "arr.json"), "[1,2]");
  assert.throws(() => loadPreset("arr"), /must be a JSON object/);
});

test("completion scripts mention every subcommand they complete", () => {
  for (const shell of SUPPORTED_SHELLS) {
    const script = completionScript(shell);
    for (const sub of ["list", "show", "create", "clone", "edit", "doctor", "remove"]) {
      assert.ok(script.includes(sub), `${shell} script should offer '${sub}'`);
    }
    assert.ok(script.includes("ccgear list --names"), `${shell} should source preset names`);
  }
});

test("clone and completion cannot be used as preset names", () => {
  assert.match(validateName("clone"), /reserved/);
  assert.match(validateName("completion"), /reserved/);
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

test("parseLaunchArgs keeps ccgear's own flags out of claude's arguments", () => {
  // --warm tells ccgear to connect first; claude would reject it as unknown.
  const parsed = parseLaunchArgs(["--warm", "--model", "opus"]);
  assert.deepEqual(parsed.passthrough, ["--model", "opus"]);
  assert.equal(parsed.warm, "always");
});

test("parseLaunchArgs forwards everything it does not claim", () => {
  const parsed = parseLaunchArgs(["--model", "opus", "-p", "hello"]);
  assert.deepEqual(parsed.passthrough, ["--model", "opus", "-p", "hello"]);
  assert.equal(parsed.warm, "auto");
});

test("parseLaunchArgs handles no arguments at all", () => {
  assert.deepEqual(parseLaunchArgs([]), { passthrough: [], warm: "auto", title: true });
});

test("--no-title opts out of renaming the tab without reaching claude", () => {
  const parsed = parseLaunchArgs(["--no-title", "--model", "opus"]);
  assert.equal(parsed.title, false);
  assert.deepEqual(parsed.passthrough, ["--model", "opus"]);
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

/** Stand-in for a raw-mode TTY so the prompts can be driven from a test. */
function fakeTerminal() {
  const input = new eventsModule.EventEmitter();
  input.isRaw = false;
  input.rawModeCalls = [];
  input.setRawMode = (mode) => input.rawModeCalls.push(mode);
  input.resume = () => {};
  input.pause = () => {};

  const output = { written: "", write: (chunk) => (output.written += chunk) };
  const press = (key) => input.emit("data", Buffer.from(key));
  return { input, output, press };
}

test("parseKeys splits a batched chunk into individual keys", () => {
  // A terminal can deliver a whole typed or pasted run in one data event; a
  // handler comparing the chunk to "\r" would miss the Enter at its end.
  assert.deepEqual(parseKeys("hi\r"), ["h", "i", "\r"]);
  assert.deepEqual(parseKeys(" \x1b[B\r"), [" ", "\x1b[B", "\r"]);
  assert.deepEqual(parseKeys("\x1b[A\x1b[B"), ["\x1b[A", "\x1b[B"]);
  assert.deepEqual(parseKeys(""), []);
});

test("multiSelect handles several keys arriving in one chunk", async () => {
  const { input, output, press } = fakeTerminal();
  const pending = multiSelect({
    title: "Pick",
    choices: ["alpha", "beta", "gamma"],
    input,
    output,
  });

  press(" \x1b[B\x1b[B \r"); // select alpha, move twice, select gamma, confirm

  assert.deepEqual(await pending, ["alpha", "gamma"]);
});

test("askText reads a line delivered as one chunk", async () => {
  const { input, output, press } = fakeTerminal();
  const pending = askText("Name:", { input, output });
  press("hello\r");
  assert.equal(await pending, "hello");
});

test("askText supports backspace and falls back when left empty", async () => {
  const term = fakeTerminal();
  const typed = askText("Name:", { input: term.input, output: term.output });
  term.press("ab");
  term.press("\x7f");
  term.press("\r");
  assert.equal(await typed, "a");

  const blank = fakeTerminal();
  const defaulted = askText("Name:", {
    input: blank.input,
    output: blank.output,
    fallback: "previous",
  });
  blank.press("\r");
  assert.equal(await defaulted, "previous");
});

test("multiSelect toggles with space and returns in list order", async () => {
  const { input, output, press } = fakeTerminal();
  const pending = multiSelect({
    title: "Pick",
    choices: ["alpha", "beta", "gamma"],
    input,
    output,
  });

  press(" "); // select alpha
  press("\x1b[B"); // down to beta
  press("\x1b[B"); // down to gamma
  press(" "); // select gamma
  press("\r");

  assert.deepEqual(await pending, ["alpha", "gamma"]);
});

test("multiSelect starts from the given selection and can deselect", async () => {
  const { input, output, press } = fakeTerminal();
  const pending = multiSelect({
    title: "Pick",
    choices: ["alpha", "beta"],
    selected: ["alpha", "beta"],
    input,
    output,
  });

  press(" "); // deselect alpha
  press("\r");

  assert.deepEqual(await pending, ["beta"]);
});

test("multiSelect supports select-all and select-none", async () => {
  const { input, output, press } = fakeTerminal();
  const pending = multiSelect({ title: "Pick", choices: ["a", "b"], input, output });

  press("a");
  press("n");
  press("a");
  press("\r");

  assert.deepEqual(await pending, ["a", "b"]);
});

test("multiSelect restores the terminal when it finishes", async () => {
  const { input, output, press } = fakeTerminal();
  const pending = multiSelect({ title: "Pick", choices: ["a"], input, output });
  press("\r");
  await pending;

  assert.deepEqual(input.rawModeCalls, [true, false], "raw mode must be turned back off");
  assert.ok(output.written.includes("\x1b[?25h"), "cursor must be made visible again");
});

test("multiSelect restores the terminal when cancelled", async () => {
  const { input, output, press } = fakeTerminal();
  let cancelled = false;
  multiSelect({
    title: "Pick",
    choices: ["a"],
    input,
    output,
    onCancel: () => (cancelled = true),
  });

  press("\x03"); // Ctrl+C

  assert.ok(cancelled);
  assert.deepEqual(input.rawModeCalls, [true, false]);
  assert.ok(output.written.includes("\x1b[?25h"));
});

test("multiSelect skips an empty list instead of prompting", async () => {
  assert.deepEqual(await multiSelect({ title: "Pick", choices: [] }), []);
});

test("diagnose warns about an empty preset", () => {
  const issues = diagnose({});
  assert.ok(issues.some((i) => i.level === "warn" && i.message.includes("empty")));
});

process.on("exit", () => rmSync(process.env.CCGEAR_DIR, { recursive: true, force: true }));
