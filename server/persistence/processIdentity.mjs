import { createHash } from "node:crypto";
import { readFileSync, readlinkSync } from "node:fs";

function requireFunction(value, name) {
  if (typeof value !== "function") throw new TypeError(`${name} must be a function`);
  return value;
}

function positiveSafeInteger(value) {
  if (typeof value === "number") return Number.isSafeInteger(value) && value > 0 ? value : null;
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

function processPid(value) {
  const pid = positiveSafeInteger(value);
  return pid !== null && pid >= 2 ? pid : null;
}

function positiveDecimal(value) {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return null;
  return value;
}

function parseProcStat(stat, pid) {
  if (typeof stat !== "string") return { processGroupId: null, procStartTicks: null };
  const close = stat.lastIndexOf(")");
  if (close < 0 || stat[close + 1] !== " " || positiveSafeInteger(stat.slice(0, stat.indexOf(" "))) !== pid) {
    return { processGroupId: null, procStartTicks: null };
  }
  // The suffix begins at field 3 (state); pgrp and starttime are fields 5 and 22.
  const fields = stat.slice(close + 2).trim().split(/\s+/);
  if (fields.length < 20 || !/^[A-Za-z]$/.test(fields[0])) {
    return { processGroupId: null, procStartTicks: null };
  }
  return {
    processGroupId: positiveSafeInteger(fields[2]),
    procStartTicks: positiveDecimal(fields[19]),
  };
}

/** Capture the Linux process identity fields needed to detect PID reuse. */
export function readProcessIdentity(pid, options = {}) {
  if (!Number.isSafeInteger(pid) || pid < 2) throw new Error(`invalid process pid: ${pid}`);
  if (options === null || typeof options !== "object") throw new TypeError("process identity options must be an object");
  const readFile = requireFunction(options.readFile === undefined ? readFileSync : options.readFile, "readFile");
  const readlink = requireFunction(options.readlink === undefined ? readlinkSync : options.readlink, "readlink");
  const optionalRead = (path, encoding = "utf8") => {
    try { return readFile(path, encoding); } catch { return null; }
  };

  const { processGroupId, procStartTicks } = parseProcStat(optionalRead(`/proc/${pid}/stat`), pid);
  let executable = null;
  try {
    const target = readlink(`/proc/${pid}/exe`);
    executable = typeof target === "string" && target.length > 0 ? target : null;
  } catch {}
  const command = optionalRead(`/proc/${pid}/cmdline`, null);
  let commandSha256 = null;
  if (typeof command === "string" || ArrayBuffer.isView(command)) {
    commandSha256 = createHash("sha256").update(command).digest("hex");
  }
  const bootIdValue = optionalRead("/proc/sys/kernel/random/boot_id");
  const bootId = typeof bootIdValue === "string" ? bootIdValue.trim() || null : null;
  return Object.freeze({ pid, processGroupId, bootId, procStartTicks, executable, commandSha256 });
}

function optionalStringMatches(persisted, observed) {
  return persisted == null || (typeof persisted === "string" && typeof observed === "string" && persisted === observed);
}

/** A PID is live-owned only when strong identity and every persisted fingerprint agree. */
export function processIdentityMatches(record, identity) {
  try {
    if (!record || !identity) return false;
    const persistedPid = processPid(record.pid);
    const observedPid = processPid(identity.pid);
    const persistedTicks = positiveDecimal(record.proc_start_ticks);
    const observedTicks = positiveDecimal(identity.procStartTicks);
    if (persistedPid === null || persistedPid !== observedPid
      || typeof record.boot_id !== "string" || record.boot_id.length === 0
      || record.boot_id !== identity.bootId
      || persistedTicks === null || persistedTicks !== observedTicks) return false;

    if (record.process_group_id != null) {
      const persistedProcessGroupId = positiveSafeInteger(record.process_group_id);
      if (persistedProcessGroupId === null
        || persistedProcessGroupId !== positiveSafeInteger(identity.processGroupId)) return false;
    }
    return optionalStringMatches(record.executable, identity.executable)
      && optionalStringMatches(record.command_sha256, identity.commandSha256);
  } catch {
    // Treat malformed or accessor-backed persistence records as untrusted input.
    return false;
  }
}

export function verifyPersistedProcessIdentity(record, options) {
  try {
    const pid = processPid(record?.pid);
    return pid !== null && processIdentityMatches(record, readProcessIdentity(pid, options));
  } catch {
    return false;
  }
}
