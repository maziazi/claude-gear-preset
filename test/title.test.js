import { test } from "node:test";
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";

const { transcriptPath, latestUserPrompt, firstUserPrompt, formatTitle, startTitleWatcher } =
  await import("../dist/title.js");

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

test("firstUserPrompt names the session after what it opened with", () => {
  // The tab must not rename itself as the conversation moves on.
  const transcript = [userEntry("the original ask"), userEntry("a later aside")].join("\n");
  assert.equal(firstUserPrompt(transcript), "the original ask");
});

test("firstUserPrompt skips reminders that precede the real first prompt", () => {
  const transcript = [
    userEntry("<system-reminder>context</system-reminder>"),
    userEntry("the real opening"),
  ].join("\n");
  assert.equal(firstUserPrompt(transcript), "the real opening");
});

test("firstUserPrompt returns null before anything is typed", () => {
  assert.equal(firstUserPrompt(""), null);
  assert.equal(firstUserPrompt(line({ type: "assistant" })), null);
});

test("transcriptPath folds a Windows drive colon into the slug", () => {
  // A colon cannot appear in a directory name, so leaving it in produced a
  // path Windows refuses to create.
  const path = transcriptPath("s1", "C:\\Users\\me\\Code");
  assert.ok(!path.slice(2).includes(":"), `colon left in slug: ${path}`);
});

test("the watcher repeats one title instead of tracking the newest prompt", async () => {
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");

  const dir = mkdtempSync(join(tmpdir(), "ccgear-title-"));
  const path = join(dir, "session.jsonl");
  writeFileSync(path, userEntry("opening question"));

  const written = [];
  const stop = startTitleWatcher("dev", "unused", dir, {
    path,
    write: (t) => written.push(t),
  });
  await new Promise((r) => setTimeout(r, 2300));

  // A later prompt must not change what is already on the tab.
  writeFileSync(path, [userEntry("opening question"), userEntry("unrelated follow-up")].join("\n"));
  await new Promise((r) => setTimeout(r, 1200));
  stop();

  assert.ok(written.length >= 2, "title must be re-asserted, not written once");
  assert.equal(new Set(written).size, 1, "every write must carry the same title");
  assert.match(written[0], /dev - opening question/);
});

test("the watcher stays quiet until the first prompt exists", async () => {
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");

  const dir = mkdtempSync(join(tmpdir(), "ccgear-title-empty-"));
  const path = join(dir, "session.jsonl");

  const written = [];
  const stop = startTitleWatcher("dev", "unused", dir, {
    path,
    write: (t) => written.push(t),
  });
  await new Promise((r) => setTimeout(r, 1300));
  assert.deepEqual(written, [], "nothing to name the tab after yet");

  writeFileSync(path, userEntry("now we have one"));
  await new Promise((r) => setTimeout(r, 1300));
  stop();
  assert.ok(written.length >= 1);
  assert.match(written[0], /dev - now we have one/);
});
