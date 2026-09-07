import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHeadlessDriver } from "./headless-driver.mjs";

const execute = promisify(execFile);

export function createAntigravityDriver(options = {}) {
  return createHeadlessDriver({ id: "antigravity", label: "Antigravity CLI", kind: "antigravity", provider: "antigravity", ...options });
}

export async function discoverAntigravityModels({ bin, cwd, env, signal }) {
  const { stdout } = await execute(bin, ["models"], { cwd, env, signal, timeout: 20000, maxBuffer: 1024 * 1024 });
  return stdout.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^([a-z0-9][a-z0-9._-]*)\t+(.+)$/);
    return match ? [{ provider: "antigravity", id: match[1], name: match[2].trim() }] : [];
  });
}
