import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { presetSkillsDir, presetCommandsDir } from "./paths.js";
import type { McpServerDefinition } from "./types.js";

/** Skill and command names become directory and file names. */
const SLUG = /^[a-z0-9][a-z0-9-]*$/;

export function validateSlug(name: string): string | null {
  if (!SLUG.test(name)) {
    return `Invalid name '${name}'. Use lowercase letters, digits and '-', starting with a letter or digit.`;
  }
  return null;
}

/** Split a shell-style argument string, honouring simple quoting. */
export function splitArgs(input: string): string[] {
  const args: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;

  for (const char of input.trim()) {
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) args.push(current);
      current = "";
      continue;
    }
    current += char;
  }

  if (current) args.push(current);
  return args;
}

/**
 * Parse `KEY=value` pairs, one per comma-separated entry.
 *
 * Returns null for a malformed entry so the caller can re-ask rather than
 * silently dropping a variable the server needs.
 */
export function parsePairs(input: string): Record<string, string> | null {
  const trimmed = input.trim();
  if (!trimmed) return {};

  const pairs: Record<string, string> = {};
  for (const entry of trimmed.split(",")) {
    const index = entry.indexOf("=");
    if (index <= 0) return null;
    const key = entry.slice(0, index).trim();
    const value = entry.slice(index + 1).trim();
    if (!key) return null;
    pairs[key] = value;
  }
  return pairs;
}

export interface StdioAnswers {
  command: string;
  args: string;
  env: string;
}

export interface HttpAnswers {
  url: string;
  headers: string;
}

export function buildStdioServer(answers: StdioAnswers): McpServerDefinition {
  const definition: McpServerDefinition = { command: answers.command.trim() };
  const args = splitArgs(answers.args);
  if (args.length > 0) definition.args = args;
  const env = parsePairs(answers.env);
  if (env && Object.keys(env).length > 0) definition.env = env;
  return definition;
}

export function buildHttpServer(answers: HttpAnswers): McpServerDefinition {
  const definition: McpServerDefinition = {
    type: "http",
    url: answers.url.trim(),
  };
  const headers = parsePairs(answers.headers);
  if (headers && Object.keys(headers).length > 0) definition.headers = headers;
  return definition;
}

export function skillTemplate(name: string, description: string): string {
  return `---
name: ${name}
description: ${description || `What ${name} is for, so Claude knows when to use it.`}
---

Replace this with the guidance Claude should follow.
`;
}

export function commandTemplate(name: string, description: string): string {
  return `---
description: ${description || `What /${name} does.`}
---

Replace this with the prompt that runs when /${name} is used.
`;
}

export interface ScaffoldResult {
  path: string;
  created: boolean;
}

/**
 * Create a skill inside a preset's own assets folder.
 *
 * Preset-owned rather than global on purpose: a skill added this way travels
 * with the preset, so it keeps working on a machine where nothing is
 * installed.
 */
export function scaffoldSkill(
  preset: string,
  name: string,
  description: string,
): ScaffoldResult {
  const dir = join(presetSkillsDir(preset), name);
  const path = join(dir, "SKILL.md");
  if (existsSync(path)) return { path, created: false };

  mkdirSync(dir, { recursive: true });
  writeFileSync(path, skillTemplate(name, description));
  return { path, created: true };
}

export function scaffoldCommand(
  preset: string,
  name: string,
  description: string,
): ScaffoldResult {
  const dir = presetCommandsDir(preset);
  const path = join(dir, `${name}.md`);
  if (existsSync(path)) return { path, created: false };

  mkdirSync(dir, { recursive: true });
  writeFileSync(path, commandTemplate(name, description));
  return { path, created: true };
}
