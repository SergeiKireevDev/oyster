#!/usr/bin/env node
import { once } from "node:events";
import { createOysterHub } from "./app.mjs";
import { loadConfig } from "./config.mjs";
import { createWorkspaceDriver } from "./drivers/index.mjs";
import { openLlmboxBinding } from "./llmbox-binding.mjs";
import { attachSpokeProxy } from "./spoke-proxy.mjs";

let bindings = [];
let server = null;
let shutdownPromise = null;
let detachSpokeProxy = null;

async function shutdown() {
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = (async () => {
    detachSpokeProxy?.();
    detachSpokeProxy = null;
    await server?.boxRegistry?.close?.();
    await Promise.all(bindings.map((binding) => binding?.close()));
    bindings = [];
    if (server?.listening) {
      server.close();
      await once(server, "close");
    }
  })();
  return shutdownPromise;
}

try {
  const { config, configPath } = await loadConfig();
  const driverConfigs = config.driver.type === "composite" ? config.driver.drivers : [config.driver];
  bindings = await Promise.all(driverConfigs.map((driverConfig) => driverConfig.transport === "native"
    ? openLlmboxBinding(driverConfig.binding)
    : null));
  const driver = config.driver.type === "composite"
    ? createWorkspaceDriver(config.driver, { bindings })
    : createWorkspaceDriver(config.driver, { binding: bindings[0] });
  server = createOysterHub(config, { driver });
  const nativeBinding = bindings.find((candidate) => candidate?.address);
  if (nativeBinding) detachSpokeProxy = attachSpokeProxy(server, nativeBinding.address);
  server.listen(config.port, config.host, () => {
    const address = server.address();
    const host = address.address.includes(":") ? `[${address.address}]` : address.address;
    console.log(`Oyster Hub listening on http://${host}:${address.port}`);
    console.log(`Using ${config.driver.type} workspace driver at ${config.driver.endpoint} from ${configPath}`);
    if (config.driver.type === "composite") console.log(`Workspace drivers: ${driverConfigs.map(({ type }) => type).join(", ")}`);
    if (nativeBinding?.address) console.log(`Embedded llmbox spoke listener: ${nativeBinding.address}`);
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
