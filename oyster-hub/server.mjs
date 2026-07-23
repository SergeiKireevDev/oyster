#!/usr/bin/env node
import { createOysterHub } from "./app.mjs";
import { loadConfig } from "./config.mjs";

try {
  const { config, configPath } = await loadConfig();
  const server = createOysterHub(config);
  server.listen(config.port, config.host, () => {
    const address = server.address();
    const host = address.address.includes(":") ? `[${address.address}]` : address.address;
    console.log(`Oyster Hub listening on http://${host}:${address.port}`);
    console.log(`Using ${config.driver.type} workspace driver at ${config.driver.endpoint} from ${configPath}`);
  });
} catch (error) {
  console.error(`Cannot start Oyster Hub: ${error.message}`);
  process.exitCode = 1;
}
