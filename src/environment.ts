import { spawnSync } from "node:child_process";
import type { DoctorIssue } from "./types.js";

/** Flags ccgear depends on to isolate a session. */
export const REQUIRED_FLAGS = [
  "--mcp-config",
  "--strict-mcp-config",
  "--setting-sources",
  "--plugin-dir",
];

/**
 * Check that `claude` is installed and new enough.
 *
 * Feature-detects by reading `claude --help` rather than comparing version
 * numbers, so it keeps working regardless of when each flag landed.
 */
export function checkEnvironment(): DoctorIssue[] {
  const result = spawnSync("claude", ["--help"], { encoding: "utf8" });

  if (result.error) {
    return [
      {
        level: "error",
        message:
          "'claude' not found on PATH. Install Claude Code: https://claude.com/claude-code",
      },
    ];
  }

  const help = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const missing = REQUIRED_FLAGS.filter((flag) => !help.includes(flag));

  if (missing.length > 0) {
    return [
      {
        level: "error",
        message:
          `Your Claude Code build does not support ${missing.join(", ")}. ` +
          "Update it with: claude update",
      },
    ];
  }

  return [];
}
