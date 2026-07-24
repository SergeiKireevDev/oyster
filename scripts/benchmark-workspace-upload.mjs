import { once } from "node:events";
import { createServer } from "node:http";
import { Readable } from "node:stream";
import { createOysterHub } from "../oyster-hub/app.mjs";
import { validateConfig } from "../oyster-hub/config.mjs";

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return `http://127.0.0.1:${server.address().port}`;
}

async function close(server) {
  server.close();
  await once(server, "close");
}

function generatedBody(totalBytes) {
  async function* chunks() {
    const chunk = Buffer.alloc(64 * 1024, 0x5a);
    let sent = 0;
    while (sent < totalBytes) {
      const size = Math.min(chunk.length, totalBytes - sent);
      sent += size;
      yield chunk.subarray(0, size);
    }
  }
  return Readable.from(chunks());
}

const upstream = createServer(async (req, res) => {
  let received = 0;
  for await (const chunk of req) received += chunk.length;
  const body = JSON.stringify({ received });
  res.writeHead(200, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
  res.end(body);
});
const upstreamUrl = await listen(upstream);
const workspace = { id: "benchmark", name: "Benchmark", url: upstreamUrl, token: null };
const driver = {
  type: "benchmark",
  endpoint: upstreamUrl,
  capabilities: { list: true },
  async listWorkspaces() { return [workspace]; },
  async getWorkspace(id) { return id === workspace.id ? workspace : null; },
};
const config = validateConfig({
  token: "benchmark-secret",
  timeoutMs: 5000,
  uploadIdleTimeoutMs: 30000,
  uploadResponseTimeoutMs: 30000,
  maxConcurrentUploads: 1,
  driver: { type: "mock", endpoint: upstreamUrl },
}, {});
const hub = createOysterHub(config, { driver, logger: { error() {} } });
const hubUrl = await listen(hub);

try {
  for (const totalBytes of [8 << 20, 64 << 20]) {
    globalThis.gc?.();
    const baselineRss = process.memoryUsage.rss();
    let peakRss = baselineRss;
    const sampler = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage.rss()); }, 5);
    const started = performance.now();
    const response = await fetch(`${hubUrl}/file-upload?workspace=benchmark&dir=%2Ftmp&name=benchmark.bin&offset=0&last=1`, {
      method: "POST",
      headers: {
        "x-auth-token": "benchmark-secret",
        "content-type": "application/octet-stream",
        "content-length": String(totalBytes),
      },
      body: generatedBody(totalBytes),
      duplex: "half",
    });
    const result = await response.json();
    clearInterval(sampler);
    if (!response.ok || result.received !== totalBytes) throw new Error(`benchmark transfer failed: ${response.status} ${JSON.stringify(result)}`);
    console.log(JSON.stringify({
      bytes: totalBytes,
      elapsedMs: Math.round(performance.now() - started),
      peakRssDeltaBytes: Math.max(0, peakRss - baselineRss),
      note: "diagnostic only; timing and RSS are not CI thresholds",
    }));
  }
} finally {
  await close(hub);
  await close(upstream);
}
