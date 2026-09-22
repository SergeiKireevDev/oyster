import { appendFileSync, closeSync, constants, createReadStream, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
const MAGIC_1000 = 1000;
const MAGIC_1024 = 1024;
const MAGIC_200 = 200;
const MAGIC_201 = 201;
const MAGIC_24 = 24;
const MAGIC_400 = 400;
const MAGIC_403 = 403;
const MAGIC_404 = 404;
const MAGIC_409 = 409;
const MAGIC_413 = 413;
const MAGIC_415 = 415;
const MAGIC_500 = 500;
const MAGIC_60 = 60;
const MAGIC_OCTAL_666 = 0o666;


const isHidden = (name) => name.startsWith(".");
const STALE_UPLOAD_AGE_MS = MAGIC_24 * MAGIC_60 * MAGIC_60 * MAGIC_1000;
const MAX_EDITABLE_FILE_SIZE = 2 * MAGIC_1024 * MAGIC_1024;
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
  const fd = openSync(path, flags, MAGIC_OCTAL_666);
  try {
    if (append) appendFileSync(fd, buffer);
    else writeFileSync(fd, buffer);
  } finally {
    closeSync(fd);
  }
}

function uploadTempPath(dir, name, offset) {
  const currentTmp = join(dir, `${UPLOAD_PREFIX}${name}${UPLOAD_SUFFIX}`);
  const legacyTmp = join(dir, `.${name}.upload`);
  return offset > 0 && !existsSync(currentTmp) && existsSync(legacyTmp) ? legacyTmp : currentTmp;
}

function continuePartialUpload({ tmp, target, offset, buf, last }) {
  let cur = -1;
  try { cur = statSync(tmp).size; } catch {}
  if (cur === -1 && last && fileRangeEquals(target, offset, buf, offset + buf.length)) {
    return { status: 200, body: { saved: target, bytes: offset + buf.length } };
  }
  if (cur >= offset + buf.length && fileRangeEquals(tmp, offset, buf)) {
    if (!last) return { status: 200, body: { received: cur } };
    if (cur !== offset + buf.length) {
      return { status: 409, body: { error: "final chunk does not end at the current upload size", have: cur } };
    }
    return null;
  }
  if (cur !== offset) {
    return { status: 409, body: { error: `chunk out of sequence: have ${cur} bytes, got offset ${offset}`, have: Math.max(cur, 0) } };
  }
  writeUploadChunk(tmp, buf, { append: true });
  return null;
}

function applyUploadChunk({ tmp, target, offset, buf, last }) {
  try {
    const response = offset === 0
      ? (writeUploadChunk(tmp, buf), null)
      : continuePartialUpload({ tmp, target, offset, buf, last });
    if (response) return response;
    if (last) renameSync(tmp, target);
    return null;
  } catch {
    try { unlinkSync(tmp); } catch {}
    return { status: 500, body: { error: "upload failed" } };
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
  const forbidden = (res, path) => json(res, MAGIC_403, { error: `path outside the allowed roots: ${String(path ?? "")}` });

  function validUploadName(name) {
    return Boolean(name) && name !== "." && name !== ".." && !/[/\\]/.test(name);
  }

  function parseUploadRequest(url) {
    const dir = resolveSafePath(resolve(String(url.searchParams.get("dir") ?? "")));
    if (!dir) return { status: 403, forbiddenPath: url.searchParams.get("dir") };
    const name = String(url.searchParams.get("name") ?? "").trim();
    if (!validUploadName(name)) return { status: 400, body: { error: "invalid file name" } };
    let dirOk = false;
    try { dirOk = statSync(dir).isDirectory(); } catch {}
    if (!dirOk) return { status: 400, body: { error: `not a directory: ${dir}` } };
    const offset = Number(url.searchParams.get("offset") ?? 0);
    if (!Number.isSafeInteger(offset) || offset < 0) return { status: 400, body: { error: "invalid offset" } };
    return { dir, name, offset, last: url.searchParams.get("last") !== "0" };
  }

  async function readUploadChunk(req, offset) {
    let buf;
    try { buf = await readRawBody(req); }
    catch (error) {
      return { status: error?.code === "body_too_large" ? MAGIC_413 : MAGIC_400, body: { error: error?.code === "body_too_large" ? "upload chunk too large" : "upload body could not be read" } };
    }
    return Number.isSafeInteger(offset + buf.length) ? { buf } : { status: 400, body: { error: "invalid offset" } };
  }

  function sendUploadSuccess({ res, target, offset, buf, last }) {
    if (!last) return json(res, MAGIC_200, { received: offset + buf.length });
    let bytes;
    try { bytes = statSync(target).size; }
    catch { return json(res, MAGIC_500, { error: "upload finalization failed" }); }
    log(`[oyster] file uploaded via explorer: ${target} (${bytes} bytes)`);
    return json(res, MAGIC_200, { saved: target, bytes });
  }

  return {
    "GET /browse": (_req, res, url) => {
      const requestedPath = url.searchParams.get("path");
      const target = resolveSafePath(resolve(requestedPath || state.currentDir));
      if (!target) { forbidden(res, requestedPath); return; }
      let entries;
      try { entries = readdirSync(target, { withFileTypes: true }); }
      catch (error) { json(res, MAGIC_400, { error: `cannot read ${target}: ${error.message}` }); return; }
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
      json(res, MAGIC_200, {
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
        json(res, MAGIC_404, { error: "file could not be read" });
        return;
      }
      if (!st.isFile()) {
        closeSync(fd);
        json(res, MAGIC_400, { error: "not a file" });
        return;
      }
      // Header-safe filename: strip control chars (CR/LF would smuggle
      // headers) and non-ASCII, and neutralize quotes and backslashes.
      const safeName = basename(target).replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "'") || "download";
      res.writeHead(MAGIC_200, {
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
      try { st = statSync(target); } catch (e) { json(res, MAGIC_404, { error: e.message }); return; }
      if (!st.isFile()) { json(res, MAGIC_400, { error: "not a file" }); return; }
      if (st.size > MAX_EDITABLE_FILE_SIZE) { json(res, MAGIC_413, { error: `file too large to edit in browser (${st.size} bytes)` }); return; }
      let buf;
      try { buf = readFileSync(target); }
      catch { json(res, MAGIC_404, { error: "file could not be read" }); return; }
      // Recheck after reading because a file can grow between stat and read.
      if (buf.length > MAX_EDITABLE_FILE_SIZE) { json(res, MAGIC_413, { error: `file too large to edit in browser (${buf.length} bytes)` }); return; }
      if (buf.includes(0)) { json(res, MAGIC_415, { error: "binary file — download it instead" }); return; }
      json(res, MAGIC_200, { path: target, content: buf.toString("utf8") });
    },

    "POST /file-save": async (req, res) => {
      const body = await readJsonBody(req, res);
      if (body === undefined) return;
      if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.path !== "string") {
        json(res, MAGIC_400, { error: "path must be a string" });
        return;
      }
      const target = resolveSafePath(resolve(body.path));
      if (!target) { forbidden(res, body.path); return; }
      if (typeof body.content !== "string") { json(res, MAGIC_400, { error: "content must be a string" }); return; }
      let dirOk = false;
      try { dirOk = statSync(dirname(target)).isDirectory(); } catch {}
      if (!dirOk) { json(res, MAGIC_400, { error: `no such directory: ${dirname(target)}` }); return; }
      const temporary = join(dirname(target), `.${basename(target)}.save-${process.pid}-${randomUUID()}`);
      try {
        let mode;
        try { mode = statSync(target).mode; } catch {}
        writeFileSync(temporary, body.content, { encoding: "utf8", flag: "wx", ...(mode === undefined ? {} : { mode }) });
        renameSync(temporary, target);
      } catch {
        try { unlinkSync(temporary); } catch {}
        json(res, MAGIC_500, { error: "save failed" });
        return;
      }
      log(`[oyster] file saved via explorer: ${target}`);
      json(res, MAGIC_200, { saved: target, bytes: Buffer.byteLength(body.content) });
    },

    "POST /file-upload": async (req, res, url) => {
      const upload = parseUploadRequest(url);
      if (upload.forbiddenPath !== undefined) { forbidden(res, upload.forbiddenPath); return; }
      if (upload.body) { json(res, upload.status, upload.body); return; }
      cleanupStaleUploads(upload.dir);
      const chunk = await readUploadChunk(req, upload.offset);
      if (chunk.body) { json(res, chunk.status, chunk.body); return; }
      const target = join(upload.dir, upload.name);
      const uploadResponse = applyUploadChunk({ tmp: uploadTempPath(upload.dir, upload.name, upload.offset), target, offset: upload.offset, buf: chunk.buf, last: upload.last });
      if (uploadResponse) { json(res, uploadResponse.status, uploadResponse.body); return; }
      sendUploadSuccess({ res, target, offset: upload.offset, buf: chunk.buf, last: upload.last });
    },

    "POST /mkdir": async (req, res) => {
      const body = await readJsonBody(req, res);
      if (body === undefined) return;
      if (!body || typeof body !== "object" || Array.isArray(body)
        || typeof body.path !== "string" || typeof body.name !== "string") {
        json(res, MAGIC_400, { error: "path and folder name must be strings" });
        return;
      }
      const parent = resolveSafePath(resolve(body.path));
      if (!parent) { forbidden(res, body.path); return; }
      const name = body.name.trim();
      if (!name || name === "." || name === ".." || /[/\\]/.test(name)) {
        json(res, MAGIC_400, { error: "invalid folder name" });
        return;
      }
      let parentOk = false;
      try { parentOk = statSync(parent).isDirectory(); } catch {}
      if (!parentOk) { json(res, MAGIC_400, { error: `not a directory: ${parent}` }); return; }
      const target = join(parent, name);
      if (existsSync(target)) { json(res, MAGIC_409, { error: `already exists: ${target}` }); return; }
      try { mkdirSync(target); }
      catch (error) { json(res, MAGIC_500, { error: `mkdir failed: ${error.message}` }); return; }
      log(`[oyster] created folder ${target}`);
      json(res, MAGIC_201, { path: target });
    },
  };
}
