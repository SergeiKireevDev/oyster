import { spawn } from "node:child_process";
import { closeSync, constants, fstatSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

const MAX_OUTPUT = 64 * 1024;
const DEVICE_PATTERN = /(https:\/\/auth\.ampcode\.com\/device\?[^\s]+)[\s\S]*?matches:\s*([A-Z0-9-]+)/i;

function credentialError(message, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = "amp_credential_sync_failed";
  return error;
}

/** Drive Amp's own device authorization while keeping its API key in Amp's store. */
export function createAmpOAuthCredentialSink({ bin, settingsPath, markerPath, spawnImpl = spawn } = {}) {
  if (typeof bin !== "string" || !isAbsolute(bin)) throw new TypeError("validated absolute Amp executable is required");
  for (const [value, label] of [[settingsPath, "settings"], [markerPath, "marker"]]) {
    if (typeof value !== "string" || !isAbsolute(value) || resolve(value) !== value) {
      throw new TypeError(`validated absolute Amp ${label} path is required`);
    }
  }

  function marked() {
    let descriptor;
    try {
      descriptor = openSync(markerPath, constants.O_RDONLY | constants.O_NOFOLLOW);
      if (!fstatSync(descriptor).isFile()) return false;
      return readFileSync(descriptor, "utf8").trim() === "connected";
    } catch (error) {
      if (error?.code === "ENOENT") return false;
      throw credentialError("Amp connection marker could not be loaded", error);
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
    }
  }

  function mark() {
    mkdirSync(dirname(markerPath), { recursive: true, mode: 0o700 });
    const descriptor = openSync(markerPath, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o600);
    try { writeFileSync(descriptor, "connected\n"); } finally { closeSync(descriptor); }
  }

  function run(args, { signal, onOutput } = {}) {
    return new Promise((resolvePromise, reject) => {
      const child = spawnImpl(bin, args, { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, AMP_SKIP_UPDATE_CHECK: "1", NO_BROWSER: "1" } });
      let output = "";
      const consume = (chunk) => {
        output = `${output}${chunk}`.slice(-MAX_OUTPUT);
        onOutput?.(output);
      };
      child.stdout?.on("data", consume);
      child.stderr?.on("data", consume);
      const abort = () => {
        try { child.kill("SIGTERM"); } catch {}
        setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 2000).unref();
      };
      signal?.addEventListener("abort", abort, { once: true });
      child.on("error", (error) => { signal?.removeEventListener("abort", abort); reject(error); });
      child.on("close", (code, exitSignal) => {
        signal?.removeEventListener("abort", abort);
        if (signal?.aborted) { reject(credentialError("Amp sign-in was cancelled")); return; }
        if (code !== 0) { reject(credentialError(`Amp credential command failed (${code ?? exitSignal ?? "unknown"})`)); return; }
        resolvePromise(output);
      });
    });
  }

  async function login(callbacks) {
    mkdirSync(dirname(settingsPath), { recursive: true, mode: 0o700 });
    let announced = false;
    await run(["login", "--settings-file", settingsPath], {
      signal: callbacks.signal,
      onOutput(output) {
        if (announced) return;
        const match = output.match(DEVICE_PATTERN);
        if (!match) return;
        announced = true;
        callbacks.onDeviceCode({ userCode: match[2], verificationUri: match[1] });
      },
    });
    mark();
    return Object.freeze({ type: "oauth" });
  }

  async function remove() {
    if (!marked()) return false;
    await run(["logout", "--settings-file", settingsPath]);
    rmSync(markerPath, { force: true });
    return true;
  }

  function status() { return Object.freeze({ configured: marked() }); }
  return Object.freeze({ settingsPath, markerPath, status, login, remove });
}
