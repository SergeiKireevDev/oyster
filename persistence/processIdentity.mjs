import { createHash } from "node:crypto";
import { readFileSync, readlinkSync } from "node:fs";

/** Capture the Linux process identity fields needed to detect PID reuse. */
export function readProcessIdentity(pid, { readFile = readFileSync, readlink = readlinkSync } = {}) {
  if (!Number.isInteger(pid) || pid < 2) throw new Error(`invalid process pid: ${pid}`);
  const optionalRead = (path, encoding = "utf8") => {
    try { return readFile(path, encoding); } catch { return null; }
  };
  const stat = optionalRead(`/proc/${pid}/stat`);
  let processGroupId = null;
  let procStartTicks = null;
  if (typeof stat === "string") {
    const close = stat.lastIndexOf(")");
    if (close >= 0) {
      const fields = stat.slice(close + 2).trim().split(/\s+/);
      processGroupId = Number.isInteger(Number(fields[2])) ? Number(fields[2]) : null;
      procStartTicks = fields[19] || null;
    }
  }
  let executable = null;
  try { executable = readlink(`/proc/${pid}/exe`); } catch {}
  const command = optionalRead(`/proc/${pid}/cmdline`, null);
  const commandSha256 = command == null ? null : createHash("sha256").update(command).digest("hex");
  const bootId = optionalRead("/proc/sys/kernel/random/boot_id")?.trim() || null;
  return Object.freeze({ pid, processGroupId, bootId, procStartTicks, executable, commandSha256 });
}
