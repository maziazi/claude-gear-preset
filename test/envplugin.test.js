import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { isEnvironmentPlugin } = await import("../dist/discover.js");

const root = mkdtempSync(join(tmpdir(), "ccgear-envplugin-"));

/** Build a plugin directory with the given shape. */
function plugin(name, { manifest = {}, dirs = [], files = [] } = {}) {
  const dir = join(root, name);
  mkdirSync(join(dir, ".claude-plugin"), { recursive: true });
  writeFileSync(
    join(dir, ".claude-plugin", "plugin.json"),
    JSON.stringify({ name, version: "1.0.0", ...manifest }),
  );
  for (const sub of dirs) mkdirSync(join(dir, sub), { recursive: true });
  for (const file of files) writeFileSync(join(dir, file), "{}");
  return dir;
}

test("a hooks-only plugin counts as environment integration", () => {
  // This is the shape a terminal integration takes: it reacts to session
  // events and contributes nothing the model can see.
  assert.equal(isEnvironmentPlugin(plugin("terminal", { dirs: ["hooks"] })), true);
});

test("a plugin with no hooks at all is not environment integration", () => {
  assert.equal(isEnvironmentPlugin(plugin("inert", {})), false);
});

test("hooks plus skills is a real toolkit, not environment integration", () => {
  assert.equal(
    isEnvironmentPlugin(plugin("toolkit", { dirs: ["hooks", "skills"] })),
    false,
  );
});

test("hooks plus commands or agents is not environment integration", () => {
  assert.equal(
    isEnvironmentPlugin(plugin("withcommands", { dirs: ["hooks", "commands"] })),
    false,
  );
  assert.equal(
    isEnvironmentPlugin(plugin("withagents", { dirs: ["hooks", "agents"] })),
    false,
  );
});

test("a plugin shipping MCP servers is not environment integration", () => {
  assert.equal(
    isEnvironmentPlugin(plugin("withmcp", { dirs: ["hooks"], files: [".mcp.json"] })),
    false,
  );
});

test("a manifest declaring contributions disqualifies it even with no folders", () => {
  // The manifest can point contributions at custom paths, so folders alone
  // are not enough to judge by.
  assert.equal(
    isEnvironmentPlugin(
      plugin("declared", { dirs: ["hooks"], manifest: { skills: "./elsewhere/" } }),
    ),
    false,
  );
  assert.equal(
    isEnvironmentPlugin(
      plugin("declaredcmd", { dirs: ["hooks"], manifest: { commands: "./cmds/" } }),
    ),
    false,
  );
});

test("a missing directory is not environment integration", () => {
  assert.equal(isEnvironmentPlugin(join(root, "does-not-exist")), false);
});

process.on("exit", () => {
  if (existsSync(root)) rmSync(root, { recursive: true, force: true });
});
