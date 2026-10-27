import { spawnSync } from "node:child_process";
/** Editors that need an explicit wait flag, otherwise they return immediately. */
const WAIT_FLAG = new Set(["code", "cursor", "subl", "zed"]);
/**
 * Open a file in the user's editor and block until they close it.
 * Honours $VISUAL / $EDITOR, falling back to nano.
 */
export function openEditor(path) {
    const raw = process.env.VISUAL || process.env.EDITOR || "nano";
    const parts = raw.split(/\s+/).filter(Boolean);
    const bin = parts[0];
    const args = parts.slice(1);
    if (WAIT_FLAG.has(bin) && !args.includes("--wait") && !args.includes("-w")) {
        args.push("--wait");
    }
    const result = spawnSync(bin, [...args, path], { stdio: "inherit" });
    if (result.error) {
        throw new Error(`Could not open editor '${bin}': ${result.error.message}`);
    }
}
