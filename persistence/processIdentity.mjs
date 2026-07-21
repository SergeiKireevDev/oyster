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

/** A PID is live-owned only when strong identity and every persisted fingerprint agree. */
export function processIdentityMatches(record, identity) {
  if (!record || !identity || Number(record.pid) !== Number(identity.pid)) return false;
  if (!record.boot_id || !record.proc_start_ticks || !identity.bootId || !identity.procStartTicks) return false;
  const comparisons = [
    [record.boot_id, identity.bootId],
    [String(record.proc_start_ticks), String(identity.procStartTicks)],
    [record.process_group_id, identity.processGroupId],
    [record.executable, identity.executable],
    [record.command_sha256, identity.commandSha256],
  ];
  return comparisons.every(([persisted, observed]) => persisted == null || String(persisted) === String(observed));
}

export function verifyPersistedProcessIdentity(record, options) {
  try { return processIdentityMatches(record, readProcessIdentity(Number(record.pid), options)); }
  catch { return false; }
}
