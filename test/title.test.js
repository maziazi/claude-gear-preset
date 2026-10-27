import { test } from "node:test";
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";

const { transcriptPath, latestUserPrompt, formatTitle } = await import(
  "../dist/title.js"
);

const line = (obj) => JSON.stringify(obj);
const userEntry = (content) => line({ type: "user", message: { content } });

test("transcriptPath mirrors how Claude Code namespaces a project", () => {
  assert.equal(
    transcriptPath("abc-123", "/Users/me/Code"),
    join(homedir(), ".claude", "projects", "-Users-me-Code", "abc-123.jsonl"),
  );
});

test("latestUserPrompt reads a plain string message", () => {
  assert.equal(latestUserPrompt(userEntry("hello there")), "hello there");
});

test("latestUserPrompt reads text out of content blocks", () => {
  const entry = userEntry([
    { type: "text", text: "first" },
    { type: "image", source: {} },
    { type: "text", text: "second" },
  ]);
  assert.equal(latestUserPrompt(entry), "first second");
});

test("latestUserPrompt keeps the most recent prompt", () => {
  const transcript = [userEntry("older"), userEntry("newer")].join("\n");
  assert.equal(latestUserPrompt(transcript), "newer");
});

test("latestUserPrompt ignores assistant turns", () => {
  const transcript = [
    userEntry("mine"),
    line({ type: "assistant", message: { content: "theirs" } }),
  ].join("\n");
  assert.equal(latestUserPrompt(transcript), "mine");
});

test("latestUserPrompt skips tool results and injected reminders", () => {
  // These arrive as user entries but are not what the tab should be named for.
  const transcript = [
    userEntry("the real prompt"),
    userEntry("<system-reminder>something</system-reminder>"),
    userEntry([{ type: "text", text: "<tool_result>output</tool_result>" }]),
  ].join("\n");
  assert.equal(latestUserPrompt(transcript), "the real prompt");
});

test("latestUserPrompt survives a half-written final line", () => {
  // The file is read while Claude Code is appending to it.
  const transcript = `${userEntry("complete")}\n{"type":"user","mess`;
  assert.equal(latestUserPrompt(transcript), "complete");
});

test("latestUserPrompt returns null when nothing has been typed yet", () => {
  assert.equal(latestUserPrompt(""), null);
  assert.equal(latestUserPrompt(line({ type: "assistant" })), null);
});

test("formatTitle joins preset and topic, and collapses whitespace", () => {
  assert.equal(formatTitle("dev", "build  the\nthing"), "dev - build the thing");
});

test("formatTitle falls back to the preset alone before any prompt", () => {
  assert.equal(formatTitle("dev", null), "dev");
  assert.equal(formatTitle("dev", "   "), "dev");
});

test("formatTitle truncates so a tab label stays readable", () => {
  const title = formatTitle("dev", "x".repeat(200));
  assert.ok(title.length < 60, `title too long: ${title.length}`);
  assert.ok(title.startsWith("dev - "));
});
