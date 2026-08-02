import { appendFileSync, closeSync, constants, createReadStream, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

const isHidden = (name) => name.startsWith(".");
const STALE_UPLOAD_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_EDITABLE_FILE_SIZE = 2 * 1024 * 1024;
const UPLOAD_PREFIX = ".oyster-upload-";
const UPLOAD_SUFFIX = ".part";

function cleanupStaleUploads(dir, now = Date.now()) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.startsWith(UPLOAD_PREFIX) || !entry.name.endsWith(UPLOAD_SUFFIX)) continue;
    const path = join(dir, entry.name);
    try {
      if (now - statSync(path).mtimeMs > STALE_UPLOAD_AGE_MS) unlinkSync(path);
    } catch { /* A concurrent request may have finalized the upload. */ }
  }
}

function fileRangeEquals(path, offset, expected, expectedSize) {
  let fd;
  try {
    fd = openSync(path, "r");
    const size = fstatSync(fd).size;
    if (expectedSize !== undefined && size !== expectedSize) return false;
    if (offset + expected.length > size) return false;
    const actual = Buffer.allocUnsafe(expected.length);
    let read = 0;
    while (read < actual.length) {
      const count = readSync(fd, actual, read, actual.length - read, offset + read);
      if (count === 0) return false;
      read += count;
    }
    return actual.equals(expected);
  } catch {
    return false;
  } finally {
    if (fd !== undefined) try { closeSync(fd); } catch {}
  }
}

function writeUploadChunk(path, buffer, { append = false } = {}) {
  const flags = constants.O_WRONLY | constants.O_NOFOLLOW
    | (append ? constants.O_APPEND : constants.O_CREAT | constants.O_TRUNC);
  const fd = openSync(path, flags, 0o666);
  try {
    if (append) appendFileSync(fd, buffer);
    else writeFileSync(fd, buffer);
  } finally {
    closeSync(fd);
  }
}

/** Build confined file-browser routes. */
export function createFileRoutes({ state, requestContext, logger = console } = {}) {
  if (!state || typeof state.currentDir !== "string") throw new TypeError("state.currentDir is required");
  if (!requestContext || typeof requestContext.json !== "function"
    || typeof requestContext.readJsonBody !== "function"
    || typeof requestContext.readRawBody !== "function"
    || typeof requestContext.resolveSafePath !== "function") {
    throw new TypeError("requestContext is required");
  }
  const { json, readJsonBody, readRawBody, resolveSafePath } = requestContext;
  const log = (message) => {
    try { logger?.log?.(message); } catch { /* Logging must not change an API result. */ }
  };
  const forbidden = (res, path) => json(res, 403, { error: `path outside the allowed roots: ${String(path ?? "")}` });

  return {
    "GET /browse": (_req, res, url) => {
      const requestedPath = url.searchParams.get("path");
      const target = resolveSafePath(resolve(requestedPath || state.currentDir));
      if (!target) { forbidden(res, requestedPath); return; }
      let entries;
      try { entries = readdirSync(target, { withFileTypes: true }); }
      catch (error) { json(res, 400, { error: `cannot read ${target}: ${error.message}` }); return; }
      const dirs = entries.filter((entry) => entry.isDirectory())
        .map((entry) => ({ name: entry.name, hidden: isHidden(entry.name) }))
        .sort((a, b) => a.name.localeCompare(b.name));
      let files;
      if (url.searchParams.get("files") === "1") {
        files = entries.filter((entry) => entry.isFile()).map((entry) => {
          let size = null;
          try { size = statSync(join(target, entry.name)).size; } catch {}
          return { name: entry.name, size, hidden: isHidden(entry.name) };
        }).sort((a, b) => a.name.localeCompare(b.name));
      }
      json(res, 200, {
        path: target,
        parent: dirname(target) === target ? null : dirname(target),
        dirs,
        ...(files ? { files } : {}),
        home: homedir(),
        workdir: state.currentDir,
      });
    },

    "GET /file-download": (_req, res, url) => {
      const target = resolveSafePath(resolve(String(url.searchParams.get("path") ?? "")));
      if (!target) { forbidden(res, url.searchParams.get("path")); return; }
      let fd;
      let st;
      try {
        fd = openSync(target, "r");
        st = fstatSync(fd);
      } catch {
        if (fd !== undefined) try { closeSync(fd); } catch {}
        json(res, 404, { error: "file could not be read" });
        return;
      }
      if (!st.isFile()) {
        closeSync(fd);
        json(res, 400, { error: "not a file" });
        return;
      }
      // Header-safe filename: strip control chars (CR/LF would smuggle
      // headers) and non-ASCII, and neutralize quotes and backslashes.
      const safeName = basename(target).replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "'") || "download";
      res.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-length": st.size,
        "content-disposition": `attachment; filename="${safeName}"`,
      });
      const stream = createReadStream(null, { fd, autoClose: true });
      stream.on("error", (error) => res.destroy?.(error));
      res.once?.("close", () => stream.destroy());
      stream.pipe(res);
    },

    "GET /file-content": (req, res, url) => {
      const target = resolveSafePath(resolve(String(url.searchParams.get("path") ?? "")));
      if (!target) { forbidden(res, url.searchParams.get("path")); return; }
      let st;
      try { st = statSync(target); } catch (e) { json(res, 404, { error: e.message }); return; }
      if (!st.isFile()) { json(res, 400, { error: "not a file" }); return; }
      if (st.size > MAX_EDITABLE_FILE_SIZE) { json(res, 413, { error: `file too large to edit in browser (${st.size} bytes)` }); return; }
      let buf;
      try { buf = readFileSync(target); }
      catch { json(res, 404, { error: "file could not be read" }); return; }
      // Recheck after reading because a file can grow between stat and read.
      if (buf.length > MAX_EDITABLE_FILE_SIZE) { json(res, 413, { error: `file too large to edit in browser (${buf.length} bytes)` }); return; }
      if (buf.includes(0)) { json(res, 415, { error: "binary file — download it instead" }); return; }
      json(res, 200, { path: target, content: buf.toString("utf8") });
    },

    "POST /file-save": async (req, res) => {
      const body = await readJsonBody(req, res);
      if (body === undefined) return;
      if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.path !== "string") {
        json(res, 400, { error: "path must be a string" });
        return;
      }
      const target = resolveSafePath(resolve(body.path));
      if (!target) { forbidden(res, body.path); return; }
      if (typeof body.content !== "string") { json(res, 400, { error: "content must be a string" }); return; }
      let dirOk = false;
      try { dirOk = statSync(dirname(target)).isDirectory(); } catch {}
      if (!dirOk) { json(res, 400, { error: `no such directory: ${dirname(target)}` }); return; }
      const temporary = join(dirname(target), `.${basename(target)}.save-${process.pid}-${randomUUID()}`);
      try {
        let mode;
        try { mode = statSync(target).mode; } catch {}
        writeFileSync(temporary, body.content, { encoding: "utf8", flag: "wx", ...(mode === undefined ? {} : { mode }) });
        renameSync(temporary, target);
      } catch {
        try { unlinkSync(temporary); } catch {}
        json(res, 500, { error: "save failed" });
        return;
      }
      log(`[oyster] file saved via explorer: ${target}`);
      json(res, 200, { saved: target, bytes: Buffer.byteLength(body.content) });
    },

    "POST /file-upload": async (req, res, url) => {
      // chunked raw body upload:
      //   ?dir=<target folder>&name=<file name>&offset=<byte offset>&last=<0|1>
      // chunks must arrive in order; offset=0 starts a fresh upload, last=1 finalizes.
      // single-shot uploads (no offset/last params) behave as before.
      const dir = resolveSafePath(resolve(String(url.searchParams.get("dir") ?? "")));
      if (!dir) { forbidden(res, url.searchParams.get("dir")); return; }
      const name = String(url.searchParams.get("name") ?? "").trim();
      if (!name || name === "." || name === ".." || /[/\\]/.test(name)) {
        json(res, 400, { error: "invalid file name" });
        return;
      }
      let dirOk = false;
      try { dirOk = statSync(dir).isDirectory(); } catch {}
      if (!dirOk) { json(res, 400, { error: `not a directory: ${dir}` }); return; }
      cleanupStaleUploads(dir);
      const offset = Number(url.searchParams.get("offset") ?? 0);
      const last = url.searchParams.get("last") !== "0"; // default: single-shot = final
      if (!Number.isSafeInteger(offset) || offset < 0) {
        json(res, 400, { error: "invalid offset" });
        return;
      }
      let buf;
      try { buf = await readRawBody(req); }
      catch (error) {
        json(res, error?.code === "body_too_large" ? 413 : 400, {
          error: error?.code === "body_too_large" ? "upload chunk too large" : "upload body could not be read",
        });
        return;
      }
      if (!Number.isSafeInteger(offset + buf.length)) {
        json(res, 400, { error: "invalid offset" });
        return;
      }
      const target = join(dir, name);
      const currentTmp = join(dir, `${UPLOAD_PREFIX}${name}${UPLOAD_SUFFIX}`);
      const legacyTmp = join(dir, `.${name}.upload`);
      // Finish partial uploads created by an older hot-reloaded route version.
      const tmp = offset > 0 && !existsSync(currentTmp) && existsSync(legacyTmp) ? legacyTmp : currentTmp;
      try {
        if (offset === 0) {
          writeUploadChunk(tmp, buf); // start fresh (truncates any stale partial)
        } else {
          let cur = -1;
          try { cur = statSync(tmp).size; } catch {}
          if (cur === -1 && last
            && fileRangeEquals(target, offset, buf, offset + buf.length)) {
            // Retried final chunk whose first attempt already renamed the temp file.
            json(res, 200, { saved: target, bytes: offset + buf.length });
            return;
          }
          if (cur >= offset + buf.length && fileRangeEquals(tmp, offset, buf)) {
            // Retried chunk that was already applied (response was lost).
            if (!last) { json(res, 200, { received: cur }); return; }
            if (cur !== offset + buf.length) {
              json(res, 409, { error: "final chunk does not end at the current upload size", have: cur });
              return;
            }
            // The final chunk is present but was not yet renamed.
          } else if (cur !== offset) {
            json(res, 409, { error: `chunk out of sequence: have ${cur} bytes, got offset ${offset}`, have: Math.max(cur, 0) });
            return;
          } else {
            writeUploadChunk(tmp, buf, { append: true });
          }
        }
        if (last) renameSync(tmp, target);
      } catch {
        try { unlinkSync(tmp); } catch {}
        json(res, 500, { error: "upload failed" });
        return;
      }
      if (last) {
        let bytes;
        try { bytes = statSync(target).size; }
        catch { json(res, 500, { error: "upload finalization failed" }); return; }
        log(`[oyster] file uploaded via explorer: ${target} (${bytes} bytes)`);
        json(res, 200, { saved: target, bytes });
      } else {
        json(res, 200, { received: offset + buf.length });
      }
    },

    "POST /mkdir": async (req, res) => {
      const body = await readJsonBody(req, res);
      if (body === undefined) return;
      if (!body || typeof body !== "object" || Array.isArray(body)
        || typeof body.path !== "string" || typeof body.name !== "string") {
        json(res, 400, { error: "path and folder name must be strings" });
        return;
      }
      const parent = resolveSafePath(resolve(body.path));
      if (!parent) { forbidden(res, body.path); return; }
      const name = body.name.trim();
      if (!name || name === "." || name === ".." || /[/\\]/.test(name)) {
        json(res, 400, { error: "invalid folder name" });
        return;
      }
      let parentOk = false;
      try { parentOk = statSync(parent).isDirectory(); } catch {}
      if (!parentOk) { json(res, 400, { error: `not a directory: ${parent}` }); return; }
      const target = join(parent, name);
      if (existsSync(target)) { json(res, 409, { error: `already exists: ${target}` }); return; }
      try { mkdirSync(target); }
      catch (error) { json(res, 500, { error: `mkdir failed: ${error.message}` }); return; }
      log(`[oyster] created folder ${target}`);
      json(res, 201, { path: target });
    },
  };
}
