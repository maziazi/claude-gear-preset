import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.CCGEAR_DIR = mkdtempSync(join(tmpdir(), "ccgear-add-test-"));

const {
  validateSlug,
  splitArgs,
  parsePairs,
  buildStdioServer,
  buildHttpServer,
  scaffoldSkill,
  scaffoldCommand,
} = await import("../dist/add.js");
const { selectOne } = await import("../dist/prompt.js");
const { presetSkillsDir, presetCommandsDir } = await import("../dist/paths.js");
const eventsModule = await import("node:events");

function fakeTerminal() {
  const input = new eventsModule.EventEmitter();
  input.isRaw = false;
  input.rawModeCalls = [];
  input.setRawMode = (mode) => input.rawModeCalls.push(mode);
  input.resume = () => {};
  input.pause = () => {};
  const output = { written: "", write: (chunk) => (output.written += chunk) };
  return { input, output, press: (key) => input.emit("data", Buffer.from(key)) };
}

test("validateSlug accepts kebab-case and rejects anything that breaks a path", () => {
  assert.equal(validateSlug("review-checklist"), null);
  assert.equal(validateSlug("a1"), null);
  assert.match(validateSlug("Review"), /Invalid name/);
  assert.match(validateSlug("with space"), /Invalid name/);
  assert.match(validateSlug("../escape"), /Invalid name/);
  assert.match(validateSlug("-leading"), /Invalid name/);
});

test("splitArgs keeps quoted arguments whole", () => {
  assert.deepEqual(splitArgs("-y @scope/pkg"), ["-y", "@scope/pkg"]);
  assert.deepEqual(splitArgs('--dir "/a path/here"'), ["--dir", "/a path/here"]);
  assert.deepEqual(splitArgs("  "), []);
});

test("parsePairs reads KEY=value and reports malformed input", () => {
  assert.deepEqual(parsePairs("A=1, B=2"), { A: "1", B: "2" });
  assert.deepEqual(parsePairs(""), {});
  // A value may itself contain '=', as tokens often do.
  assert.deepEqual(parsePairs("TOKEN=ab=cd"), { TOKEN: "ab=cd" });
  // Returning null lets the caller re-ask instead of dropping a variable.
  assert.equal(parsePairs("no-equals-sign"), null);
  assert.equal(parsePairs("=novalue"), null);
});

test("buildStdioServer omits empty args and env rather than writing noise", () => {
  assert.deepEqual(buildStdioServer({ command: "npx", args: "", env: "" }), {
    command: "npx",
  });
  assert.deepEqual(
    buildStdioServer({ command: " npx ", args: "-y pkg", env: "KEY=v" }),
    { command: "npx", args: ["-y", "pkg"], env: { KEY: "v" } },
  );
});

test("buildHttpServer marks the transport and omits empty headers", () => {
  assert.deepEqual(buildHttpServer({ url: " https://x/mcp ", headers: "" }), {
    type: "http",
    url: "https://x/mcp",
  });
  assert.deepEqual(
    buildHttpServer({ url: "https://x/mcp", headers: "Authorization=Bearer t" }),
    { type: "http", url: "https://x/mcp", headers: { Authorization: "Bearer t" } },
  );
});

test("scaffoldSkill writes a usable SKILL.md inside the preset", () => {
  const { path, created } = scaffoldSkill("p", "my-skill", "When to use it");
  assert.ok(created);
  assert.equal(path, join(presetSkillsDir("p"), "my-skill", "SKILL.md"));

  const body = readFileSync(path, "utf8");
  assert.match(body, /^---\nname: my-skill\ndescription: When to use it\n---/);
});

test("scaffoldCommand writes a usable command file inside the preset", () => {
  const { path, created } = scaffoldCommand("p", "standup", "Summarise today");
  assert.ok(created);
  assert.equal(path, join(presetCommandsDir("p"), "standup.md"));
  assert.match(readFileSync(path, "utf8"), /^---\ndescription: Summarise today\n---/);
});

test("scaffolding refuses to overwrite work that is already there", () => {
  scaffoldSkill("p2", "dup", "first");
  const again = scaffoldSkill("p2", "dup", "second");
  assert.equal(again.created, false);
  assert.match(readFileSync(again.path, "utf8"), /first/, "existing content must survive");
});

test("a blank description still produces valid frontmatter", () => {
  const { path } = scaffoldSkill("p3", "nodesc", "");
  const body = readFileSync(path, "utf8");
  assert.match(body, /description: .+/, "description must not be left empty");
});

test("selectOne returns the entry under the cursor", async () => {
  const { input, output, press } = fakeTerminal();
  const pending = selectOne({ title: "Pick", choices: ["a", "b", "c"], input, output });
  press("\x1b[B");
  press("\r");
  assert.equal(await pending, "b");
});

test("selectOne skips the prompt when there is only one option", async () => {
  // Nothing to decide, so asking would just be a keypress tax.
  assert.equal(await selectOne({ title: "Pick", choices: ["only"] }), "only");
});

test("selectOne restores the terminal on cancel", async () => {
  const { input, output, press } = fakeTerminal();
  let cancelled = false;
  selectOne({
    title: "Pick",
    choices: ["a", "b"],
    input,
    output,
    onCancel: () => (cancelled = true),
  });
  press("\x03");
  assert.ok(cancelled);
  assert.deepEqual(input.rawModeCalls, [true, false]);
  assert.ok(output.written.includes("\x1b[?25h"));
});

process.on("exit", () => {
  if (existsSync(process.env.CCGEAR_DIR)) {
    rmSync(process.env.CCGEAR_DIR, { recursive: true, force: true });
  }
});
