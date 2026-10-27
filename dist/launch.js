import { spawn } from "node:child_process";
import { buildBundle } from "./manifest.js";
import { discoverMcpServers } from "./discover.js";
/**
 * Build the Claude Code argument list for a preset.
 *
 * The flag combination is what makes a session actually isolated:
 *   --strict-mcp-config  ignore every MCP config except the one we pass
 *   --setting-sources    drop user-scope skills and commands
 *   --plugin-dir         add back only the skills/commands the preset names
 */
export function buildArgs(name, bundle, passthrough) {
    const args = [
        "--mcp-config",
        bundle.mcpConfigPath,
        "--strict-mcp-config",
        "--setting-sources",
        "project,local",
    ];
    if (bundle.settingsPath)
        args.push("--settings", bundle.settingsPath);
    if (bundle.pluginDir)
        args.push("--plugin-dir", bundle.pluginDir);
    args.push("-n", name);
    return args.concat(passthrough);
}
export function launch(name, preset, passthrough) {
    const bundle = buildBundle(name, preset, discoverMcpServers());
    const args = buildArgs(name, bundle, passthrough);
    let cleanedUp = false;
    const cleanup = () => {
        if (cleanedUp)
            return;
        cleanedUp = true;
        bundle.cleanup();
    };
    const child = spawn("claude", args, { stdio: "inherit" });
    child.on("error", (err) => {
        cleanup();
        console.error(`Failed to start claude: ${err.message}`);
        console.error("Is Claude Code installed and on your PATH?");
        process.exit(1);
    });
    child.on("exit", (code, signal) => {
        cleanup();
        if (signal)
            process.kill(process.pid, signal);
        else
            process.exit(code ?? 0);
    });
    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);
    process.on("exit", cleanup);
}
