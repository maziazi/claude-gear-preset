import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.CCGEAR_DIR = mkdtempSync(join(tmpdir(), "ccgear-warm-test-"));

const { fingerprint, isWarmed, markWarmed, forgetWarmed } = await import(
  "../dist/warmstate.js"
);
const { parseLaunchArgs } = await import("../dist/launch.js");

const servers = (entries) => new Map(entries);

test("fingerprint ignores the order servers are listed in", () => {
  const a = servers([
    ["one", { command: "x" }],
    ["two", { command: "y" }],
  ]);
  const b = servers([
    ["two", { command: "y" }],
    ["one", { command: "x" }],
  ]);
  assert.equal(fingerprint(a), fingerprint(b));
});

test("fingerprint ignores key order inside a definition", () => {
  const a = servers([["s", { command: "x", args: ["-y"] }]]);
  const b = servers([["s", { args: ["-y"], command: "x" }]]);
  assert.equal(fingerprint(a), fingerprint(b));
});

test("fingerprint changes when a server's command changes", () => {
  // Otherwise an edited server would never be warmed again.
  const before = servers([["s", { command: "old" }]]);
  const after = servers([["s", { command: "new" }]]);
  assert.notEqual(fingerprint(before), fingerprint(after));
});

test("fingerprint changes when a server is added", () => {
  const before = servers([["one", { command: "x" }]]);
  const after = servers([
    ["one", { command: "x" }],
    ["two", { command: "y" }],
  ]);
  assert.notEqual(fingerprint(before), fingerprint(after));
});

test("a preset is not considered warmed until it is recorded", () => {
  const print = fingerprint(servers([["s", { command: "x" }]]));
  assert.equal(isWarmed("fresh", print), false);
  markWarmed("fresh", print);
  assert.equal(isWarmed("fresh", print), true);
});

test("changing the servers makes a recorded preset count as cold again", () => {
  const before = fingerprint(servers([["s", { command: "old" }]]));
  const after = fingerprint(servers([["s", { command: "new" }]]));
  markWarmed("edited", before);
  assert.equal(isWarmed("edited", before), true);
  assert.equal(isWarmed("edited", after), false, "an edit must earn a new warm-up");
});

test("presets do not share warm records", () => {
  const print = fingerprint(servers([["s", { command: "x" }]]));
  markWarmed("alpha", print);
  assert.equal(isWarmed("beta", print), false);
});

test("forgetWarmed drops only the named preset", () => {
  const print = fingerprint(servers([["s", { command: "x" }]]));
  markWarmed("keep", print);
  markWarmed("drop", print);
  forgetWarmed("drop");
  assert.equal(isWarmed("drop", print), false);
  assert.equal(isWarmed("keep", print), true);
});

test("a corrupt state file is treated as empty rather than crashing", () => {
  writeFileSync(join(process.env.CCGEAR_DIR, ".warmed.json"), "{not json");
  assert.equal(isWarmed("anything", "abc"), false);
  // And it must recover on the next write.
  markWarmed("recovered", "abc");
  assert.equal(isWarmed("recovered", "abc"), true);
});

test("warm mode defaults to auto and both overrides are explicit", () => {
  assert.equal(parseLaunchArgs([]).warm, "auto");
  assert.equal(parseLaunchArgs(["--warm"]).warm, "always");
  assert.equal(parseLaunchArgs(["--no-warm"]).warm, "never");
});

test("--no-warm wins over --warm so an alias can be overridden", () => {
  assert.equal(parseLaunchArgs(["--warm", "--no-warm"]).warm, "never");
});

test("neither warm flag is forwarded to claude", () => {
  const { passthrough } = parseLaunchArgs(["--warm", "--no-warm", "--model", "opus"]);
  assert.deepEqual(passthrough, ["--model", "opus"]);
});

process.on("exit", () => {
  if (existsSync(process.env.CCGEAR_DIR)) {
    rmSync(process.env.CCGEAR_DIR, { recursive: true, force: true });
  }
});
