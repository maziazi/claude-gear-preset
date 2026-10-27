import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";

const { probeServer, probeAll } = await import("../dist/probe.js");

/** Routes used by the HTTP probe tests, keyed by path. */
const routes = {
  "/ok": (res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: { serverInfo: { name: "Fake", version: "1.2.3" } },
      }),
    );
  },
  "/sse": (res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end(
      `event: message\ndata: ${JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: { serverInfo: { name: "Streamed", version: "9.9" } },
      })}\n\n`,
    );
  },
  "/unauthorized": (res) => {
    res.writeHead(401).end();
  },
  "/broken": (res) => {
    res.writeHead(500).end();
  },
  "/rpc-error": (res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32000, message: "nope" } }),
    );
  },
  "/garbage": (res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end("not json at all");
  },
  "/hang": () => {
    // Never responds, so the probe has to time out.
  },
};

let server;
let base;

before(async () => {
  server = createServer((req, res) => {
    const handler = routes[req.url];
    if (handler) handler(res);
    else res.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

test("an HTTP server that answers initialize reports its name", async () => {
  const result = await probeServer("ok", { type: "http", url: `${base}/ok` });
  assert.equal(result.status, "ok");
  assert.match(result.detail, /Fake 1\.2\.3/);
});

test("a result delivered as an SSE frame is understood", async () => {
  const result = await probeServer("sse", { type: "http", url: `${base}/sse` });
  assert.equal(result.status, "ok");
  assert.match(result.detail, /Streamed 9\.9/);
});

test("401 is reported as needing authentication, not as broken", async () => {
  // The distinction matters: one is fixed by signing in, the other is not.
  const result = await probeServer("auth", { type: "http", url: `${base}/unauthorized` });
  assert.equal(result.status, "auth");
  assert.match(result.detail, /needs authentication/);
});

test("a server error is reported as failed", async () => {
  const result = await probeServer("broken", { type: "http", url: `${base}/broken` });
  assert.equal(result.status, "failed");
  assert.match(result.detail, /HTTP 500/);
});

test("a JSON-RPC error is surfaced with its message", async () => {
  const result = await probeServer("rpc", { type: "http", url: `${base}/rpc-error` });
  assert.equal(result.status, "failed");
  assert.match(result.detail, /nope/);
});

test("an unreadable body is reported rather than thrown", async () => {
  const result = await probeServer("garbage", { type: "http", url: `${base}/garbage` });
  assert.equal(result.status, "failed");
  assert.match(result.detail, /unreadable/);
});

test("a server that never answers times out", async () => {
  const result = await probeServer("hang", { type: "http", url: `${base}/hang` }, 300);
  assert.equal(result.status, "failed");
  assert.match(result.detail, /no response within/);
});

test("a stdio server that answers initialize reports its name", async () => {
  const script = `
    let buf = "";
    process.stdin.on("data", (d) => {
      buf += d;
      if (!buf.includes('"initialize"')) return;
      process.stdout.write(JSON.stringify({
        jsonrpc: "2.0", id: 1,
        result: { serverInfo: { name: "StdioFake", version: "0.1" } }
      }) + "\\n");
    });
  `;
  const result = await probeServer("stdio", { command: process.execPath, args: ["-e", script] });
  assert.equal(result.status, "ok");
  assert.match(result.detail, /StdioFake 0\.1/);
});

test("a missing binary names the command that was not found", async () => {
  const result = await probeServer("gone", { command: "ccgear-no-such-binary-xyz" });
  assert.equal(result.status, "failed");
  assert.match(result.detail, /command not found: ccgear-no-such-binary-xyz/);
});

test("a stdio server that exits without replying is reported", async () => {
  const result = await probeServer("quitter", { command: process.execPath, args: ["-e", ""] });
  assert.equal(result.status, "failed");
  assert.match(result.detail, /exited before replying/);
});

test("a definition with neither url nor command is rejected", async () => {
  const result = await probeServer("empty", {});
  assert.equal(result.status, "failed");
  assert.match(result.detail, /neither 'url' nor 'command'/);
});

test("probeAll keeps every server's result", async () => {
  const results = await probeAll(
    new Map([
      ["good", { type: "http", url: `${base}/ok` }],
      ["locked", { type: "http", url: `${base}/unauthorized` }],
    ]),
  );
  assert.equal(results.length, 2);
  assert.equal(results.find((r) => r.name === "good").status, "ok");
  assert.equal(results.find((r) => r.name === "locked").status, "auth");
});
