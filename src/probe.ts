import { spawn } from "node:child_process";
import type { McpServerDefinition } from "./types.js";

export type ProbeStatus = "ok" | "auth" | "failed";

export interface ProbeResult {
  name: string;
  status: ProbeStatus;
  detail: string;
}

const DEFAULT_TIMEOUT_MS = 20_000;

/** The opening message of an MCP session; a server that answers it is alive. */
function initializeRequest(): string {
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

function describe(result: unknown): string {
  const info = (result as { serverInfo?: { name?: string; version?: string } })?.serverInfo;
  if (!info?.name) return "connected";
  return `connected — ${info.name}${info.version ? ` ${info.version}` : ""}`;
}

async function probeHttp(url: string, def: McpServerDefinition, timeoutMs: number): Promise<Omit<ProbeResult, "name">> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    ...((def.headers as Record<string, string>) ?? {}),
  };

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      body: initializeRequest(),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
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
    if (message.error) return { status: "failed", detail: String(message.error.message ?? "error") };
    return { status: "ok", detail: describe(message.result) };
  } catch {
    return { status: "failed", detail: "unreadable response" };
  }
}

function probeStdio(def: McpServerDefinition, timeoutMs: number): Promise<Omit<ProbeResult, "name">> {
  return new Promise((resolve) => {
    const command = String(def.command);
    const args = (def.args as string[]) ?? [];

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, args, {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, ...((def.env as Record<string, string>) ?? {}) },
      });
    } catch (err) {
      resolve({ status: "failed", detail: err instanceof Error ? err.message : String(err) });
      return;
    }

    let settled = false;
    const finish = (result: Omit<ProbeResult, "name">) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      resolve(result);
    };

    const timer = setTimeout(
      () => finish({ status: "failed", detail: `no response within ${timeoutMs / 1000}s` }),
      timeoutMs,
    );

    let buffer = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      // Messages are newline-delimited; the banner some servers print first is
      // not JSON, so look for the reply rather than parsing every line.
      for (const line of buffer.split("\n")) {
        if (!line.includes('"id":1')) continue;
        try {
          const message = JSON.parse(line);
          finish(
            message.error
              ? { status: "failed", detail: String(message.error.message ?? "error") }
              : { status: "ok", detail: describe(message.result) },
          );
        } catch {
          // Partial line; wait for the rest.
        }
        return;
      }
    });

    child.on("error", (err: NodeJS.ErrnoException) => {
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
export async function probeServer(
  name: string,
  def: McpServerDefinition,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<ProbeResult> {
  const url = typeof def.url === "string" ? def.url : null;
  const result = url
    ? await probeHttp(url, def, timeoutMs)
    : def.command
      ? await probeStdio(def, timeoutMs)
      : { status: "failed" as const, detail: "definition has neither 'url' nor 'command'" };

  return { name, ...result };
}

export function probeAll(
  servers: Map<string, McpServerDefinition>,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<ProbeResult[]> {
  return Promise.all(
    [...servers].map(([name, def]) => probeServer(name, def, timeoutMs)),
  );
}
