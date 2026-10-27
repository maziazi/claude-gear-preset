import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { GEAR_DIR } from "./paths.js";
import type { McpServerDefinition } from "./types.js";

/** Records which server sets have already been connected to once. */
const STATE_FILE = join(GEAR_DIR, ".warmed.json");

/** Stable stringify so key order never changes the fingerprint. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
}

/**
 * Identify a preset's server set.
 *
 * Covers the definitions themselves, so adding a server or changing its
 * command counts as new and earns another warm-up, while renaming the preset
 * or editing its skills does not.
 */
export function fingerprint(servers: Map<string, McpServerDefinition>): string {
  const sorted = [...servers].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return createHash("sha256").update(canonical(sorted)).digest("hex").slice(0, 16);
}

function readState(): Record<string, string> {
  try {
    const parsed = JSON.parse(readFileSync(STATE_FILE, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function isWarmed(preset: string, print: string): boolean {
  return readState()[preset] === print;
}

/**
 * Remember that this server set has been connected to.
 *
 * Failure to record is ignored on purpose: the worst outcome is warming again
 * next time, which is slower but still correct.
 */
export function markWarmed(preset: string, print: string): void {
  try {
    mkdirSync(GEAR_DIR, { recursive: true });
    writeFileSync(STATE_FILE, JSON.stringify({ ...readState(), [preset]: print }, null, 2));
  } catch {
    // Ignored; see above.
  }
}

export function forgetWarmed(preset: string): void {
  try {
    const state = readState();
    delete state[preset];
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch {
    // Ignored; see above.
  }
}
