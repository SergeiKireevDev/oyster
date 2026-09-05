import { EventEmitter } from "node:events";
import { Readable } from "node:stream";

/**
 * Invoke a route handler in-process, without a socket or credentials.
 *
 * In-process callers (the MCP endpoint) have already been authenticated by the
 * request that reaches them, so they dispatch straight to the route table with
 * a minimal request/response pair instead of looping back over TCP with a
 * token. Handlers only need the streaming and header surface used by
 * `readJsonBody`, `json`, and `disableCaching`.
 *
 * @returns {Promise<{ status: number, data: any }>} status and parsed JSON body
 */
export function dispatchRoute(routeTable, method, path, body = undefined, { signal } = {}) {
  if (!(routeTable instanceof Map)) throw new TypeError("route table must be a Map");
  const url = new URL(String(path), "http://localhost");
  const key = `${String(method).toUpperCase()} ${url.pathname}`;
  const route = routeTable.get(key);
  if (!route) return Promise.resolve({ status: 404, data: { error: `no route ${key}` } });

  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
  const req = Object.assign(Readable.from(payload ? [payload] : []), {
    method: key.slice(0, key.indexOf(" ")),
    url: `${url.pathname}${url.search}`,
    headers: {
      host: "localhost",
      accept: "application/json",
      ...(payload ? { "content-type": "application/json", "content-length": String(payload.length) } : {}),
    },
    socket: { remoteAddress: "127.0.0.1" },
  });

  return new Promise((resolve, reject) => {
    const chunks = [];
    let settled = false;
    const headers = new Map();
    const res = Object.assign(new EventEmitter(), {
      statusCode: 200,
      headersSent: false,
      writableEnded: false,
      setHeader(name, value) { headers.set(String(name).toLowerCase(), value); return this; },
      getHeader(name) { return headers.get(String(name).toLowerCase()); },
      hasHeader(name) { return headers.has(String(name).toLowerCase()); },
      removeHeader(name) { headers.delete(String(name).toLowerCase()); },
      writeHead(status, extra) {
        this.statusCode = status;
        if (extra && typeof extra === "object") for (const [name, value] of Object.entries(extra)) this.setHeader(name, value);
        this.headersSent = true;
        return this;
      },
      flushHeaders() { this.headersSent = true; },
      write(chunk) { chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))); return true; },
      end(chunk) {
        if (chunk != null) this.write(chunk);
        this.writableEnded = true;
        finish();
      },
      destroy(error) {
        if (error) fail(error); else finish();
      },
    });
    const finish = () => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      const raw = Buffer.concat(chunks).toString("utf8");
      let data = null;
      try { data = raw ? JSON.parse(raw) : null; } catch { data = { error: raw }; }
      resolve({ status: res.statusCode, data });
      res.emit("finish");
      res.emit("close");
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      reject(error);
      res.emit("close");
    };
    const onAbort = () => {
      req.destroy();
      fail(Object.assign(new Error("request aborted"), { code: "ABORT_ERR" }));
    };
    if (signal?.aborted) { onAbort(); return; }
    signal?.addEventListener("abort", onAbort, { once: true });
    Promise.resolve().then(() => route(req, res, url)).catch(fail);
  });
}
