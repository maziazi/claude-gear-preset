import { spawn } from "node:child_process";
const DEFAULT_TIMEOUT_MS = 20_000;
/** The opening message of an MCP session; a server that answers it is alive. */
function initializeRequest() {
    return JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: { name: "ccgear", version: "1.0.0" },
        },
    });
}
function describe(result) {
    const info = result?.serverInfo;
    if (!info?.name)
        return "connected";
    return `connected — ${info.name}${info.version ? ` ${info.version}` : ""}`;
}
async function probeHttp(url, def, timeoutMs) {
    const headers = {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...(def.headers ?? {}),
    };
    let response;
    try {
        response = await fetch(url, {
            method: "POST",
            headers,
            body: initializeRequest(),
            signal: AbortSignal.timeout(timeoutMs),
        });
    }
    catch (err) {
        // AbortSignal.timeout rejects with a TimeoutError; its message is phrased
        // for developers, so say what actually happened instead.
        const timedOut = err instanceof Error && err.name === "TimeoutError";
        return {
            status: "failed",
            detail: timedOut
                ? `no response within ${timeoutMs / 1000}s`
                : err instanceof Error
                    ? err.message
                    : String(err),
        };
    }
    if (response.status === 401 || response.status === 403) {
        return { status: "auth", detail: `needs authentication (HTTP ${response.status})` };
    }
    if (!response.ok) {
        return { status: "failed", detail: `HTTP ${response.status}` };
    }
    // Responses arrive as plain JSON or as a single SSE `data:` frame.
    const body = await response.text();
    const payload = body.includes("data:")
        ? body.slice(body.indexOf("data:") + 5).split("\n")[0].trim()
        : body.trim();
    try {
        const message = JSON.parse(payload);
        if (message.error)
            return { status: "failed", detail: String(message.error.message ?? "error") };
        return { status: "ok", detail: describe(message.result) };
    }
    catch {
        return { status: "failed", detail: "unreadable response" };
    }
}
function probeStdio(def, timeoutMs) {
    return new Promise((resolve) => {
        const command = String(def.command);
        const args = def.args ?? [];
        let child;
        try {
            child = spawn(command, args, {
                stdio: ["pipe", "pipe", "pipe"],
                env: { ...process.env, ...(def.env ?? {}) },
            });
        }
        catch (err) {
            resolve({ status: "failed", detail: err instanceof Error ? err.message : String(err) });
            return;
        }
        let settled = false;
        const finish = (result) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            child.kill();
            resolve(result);
        };
        const timer = setTimeout(() => finish({ status: "failed", detail: `no response within ${timeoutMs / 1000}s` }), timeoutMs);
        let buffer = "";
        child.stdout?.on("data", (chunk) => {
            buffer += chunk.toString();
            // Messages are newline-delimited; the banner some servers print first is
            // not JSON, so look for the reply rather than parsing every line.
            for (const line of buffer.split("\n")) {
                if (!line.includes('"id":1'))
                    continue;
                try {
                    const message = JSON.parse(line);
                    finish(message.error
                        ? { status: "failed", detail: String(message.error.message ?? "error") }
                        : { status: "ok", detail: describe(message.result) });
                }
                catch {
                    // Partial line; wait for the rest.
                }
                return;
            }
        });
        child.on("error", (err) => {
            finish({
                status: "failed",
                detail: err.code === "ENOENT" ? `command not found: ${command}` : err.message,
            });
        });
        child.on("exit", (code) => {
            finish({ status: "failed", detail: `exited before replying (code ${code})` });
        });
        child.stdin?.write(`${initializeRequest()}\n`);
    });
}
/**
 * Open an MCP session with one server and report whether it answers.
 *
 * This is what the static check cannot tell you: a definition can be perfectly
 * well-formed while the binary is missing, the token has expired, or the
 * endpoint is down.
 */
export async function probeServer(name, def, timeoutMs = DEFAULT_TIMEOUT_MS) {
    const url = typeof def.url === "string" ? def.url : null;
    const result = url
        ? await probeHttp(url, def, timeoutMs)
        : def.command
            ? await probeStdio(def, timeoutMs)
            : { status: "failed", detail: "definition has neither 'url' nor 'command'" };
    return { name, ...result };
}
export function probeAll(servers, timeoutMs = DEFAULT_TIMEOUT_MS) {
    return Promise.all([...servers].map(([name, def]) => probeServer(name, def, timeoutMs)));
}
