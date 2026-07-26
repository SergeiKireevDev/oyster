import { connect } from "node:net";

function targetAddress(address) {
  const value = String(address || "").trim();
  if (!value) throw new Error("embedded llmbox listener address is unavailable");
  const url = new URL(value.includes("://") ? value : `http://${value}`);
  const port = Number(url.port || 80);
  if (!url.hostname || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`invalid embedded llmbox listener address: ${value}`);
  }
  return { host: url.hostname, port };
}

function requestHead(request) {
  let output = `${request.method} ${request.url} HTTP/${request.httpVersion}\r\n`;
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    output += `${request.rawHeaders[index]}: ${request.rawHeaders[index + 1]}\r\n`;
  }
  return `${output}\r\n`;
}

/** Forward public /spoke/connect upgrades to the private embedded llmbox listener. */
export function attachSpokeProxy(server, address, { logger = console } = {}) {
  const target = targetAddress(address);
  const onUpgrade = (request, socket, head) => {
    let url;
    try { url = new URL(request.url, "http://hub.local"); } catch { return; }
    if (url.pathname !== "/spoke/connect") return;

    const upstream = connect(target);
    let connected = false;
    upstream.once("connect", () => {
      connected = true;
      upstream.write(requestHead(request));
      if (head.length) upstream.write(head);
      socket.pipe(upstream);
      upstream.pipe(socket);
    });
    upstream.once("error", (error) => {
      logger.error?.(`Cannot proxy llmbox spoke connection: ${error.message}`);
      if (!connected && socket.writable) socket.write("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n");
      socket.destroy();
    });
    socket.once("error", () => upstream.destroy());
    socket.once("close", () => upstream.destroy());
  };
  server.on("upgrade", onUpgrade);
  return () => server.off("upgrade", onUpgrade);
}
