#!/usr/bin/env node
import { once } from "node:events";
import { createOysterHub } from "./app.mjs";
import { loadConfig } from "./config.mjs";
import { createWorkspaceDriver } from "./drivers/index.mjs";
import { openLlmboxBinding } from "./llmbox-binding.mjs";

let binding = null;
let server = null;
let shutdownPromise = null;

async function shutdown() {
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = (async () => {
    await server?.boxRegistry?.close?.();
    if (server?.listening) {
      server.close();
      await once(server, "close");
    }
    await binding?.close();
  })();
  return shutdownPromise;
}

try {
  const { config, configPath } = await loadConfig();
  if (config.driver.transport === "native") {
    binding = await openLlmboxBinding(config.driver.binding);
  }
  const driver = createWorkspaceDriver(config.driver, { binding });
  server = createOysterHub(config, { driver });
  server.listen(config.port, config.host, () => {
    const address = server.address();
    const host = address.address.includes(":") ? `[${address.address}]` : address.address;
    console.log(`Oyster Hub listening on http://${host}:${address.port}`);
    console.log(`Using ${config.driver.type} workspace driver at ${config.driver.endpoint} from ${configPath}`);
    if (binding?.address) console.log(`Embedded llmbox spoke listener: ${binding.address}`);
  });
  process.once("SIGINT", () => shutdown().then(() => process.exit(0), (error) => {
    console.error(`Cannot stop Oyster Hub: ${error.message}`);
    process.exit(1);
  }));
  process.once("SIGTERM", () => shutdown().then(() => process.exit(0), (error) => {
    console.error(`Cannot stop Oyster Hub: ${error.message}`);
    process.exit(1);
  }));
} catch (error) {
  try { await shutdown(); } catch {}
  console.error(`Cannot start Oyster Hub: ${error.message}`);
  process.exitCode = 1;
}
