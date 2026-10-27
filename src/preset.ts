import { readFileSync, writeFileSync, readdirSync, mkdirSync, unlinkSync } from "node:fs";
import { parse } from "node:path";
import { GEAR_DIR, presetPath } from "./paths.js";
import type { Preset } from "./types.js";

/** Subcommand names a preset may not shadow. */
export const RESERVED_NAMES = new Set([
  "list",
  "show",
  "create",
  "edit",
  "remove",
  "doctor",
  "help",
  "version",
]);

const NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

export function validateName(name: string): string | null {
  if (!NAME_PATTERN.test(name)) {
    return `Invalid name '${name}'. Use letters, digits, '-' and '_', starting with a letter or digit.`;
  }
  if (RESERVED_NAMES.has(name)) {
    return `'${name}' is a reserved subcommand. Pick a different preset name.`;
  }
  return null;
}

export function listPresets(): string[] {
  try {
    return readdirSync(GEAR_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => parse(f).name)
      .sort();
  } catch {
    return [];
  }
}

export function presetExists(name: string): boolean {
  return listPresets().includes(name);
}

export function loadPreset(name: string): Preset {
  const raw = readFileSync(presetPath(name), "utf8");
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Preset '${name}' is not a JSON object.`);
  }
  return parsed as Preset;
}

export function savePreset(name: string, preset: Preset): void {
  mkdirSync(GEAR_DIR, { recursive: true });
  writeFileSync(presetPath(name), JSON.stringify(preset, null, 2) + "\n");
}

export function removePreset(name: string): void {
  unlinkSync(presetPath(name));
}
