import { appendFileSync, createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

const isHidden = (name) => name.startsWith(".");

/** Build confined file-browser routes. */
export function createFileRoutes({ state, requestContext, logger = console }) {
  const { json, readJsonBody, readRawBody, resolveSafePath } = requestContext;
  const forbidden = (res, path) => json(res, 403, { error: `path outside the allowed roots: ${path}` });

  return {
    "GET /browse": (_req, res, url) => {
      const target = resolveSafePath(resolve(url.searchParams.get("path") || state.currentDir));
      if (!target) { forbidden(res, url.searchParams.get("path")); return; }
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

    "GET /file-download": (req, res, url) => {
      const target = resolveSafePath(resolve(String(url.searchParams.get("path") ?? "")));
      if (!target) { forbidden(res, url.searchParams.get("path")); return; }
      let st;
      try { st = statSync(target); } catch (e) { json(res, 404, { error: e.message }); return; }
      if (!st.isFile()) { json(res, 400, { error: "not a file" }); return; }
      // header-safe filename: strip control chars (CR/LF would smuggle
      // headers) and non-ASCII, neutralize quotes/backslashes
      const safeName = basename(target).replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "'") || "download";
      res.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-length": st.size,
        "content-disposition": `attachment; filename="${safeName}"`,
      });
      createReadStream(target).pipe(res);
    },

    "GET /file-content": (req, res, url) => {
      const target = resolveSafePath(resolve(String(url.searchParams.get("path") ?? "")));
      if (!target) { forbidden(res, url.searchParams.get("path")); return; }
      let st;
      try { st = statSync(target); } catch (e) { json(res, 404, { error: e.message }); return; }
      if (!st.isFile()) { json(res, 400, { error: "not a file" }); return; }
      if (st.size > 2 * 1024 * 1024) { json(res, 413, { error: `file too large to edit in browser (${st.size} bytes)` }); return; }
      const buf = readFileSync(target);
      if (buf.includes(0)) { json(res, 415, { error: "binary file — download it instead" }); return; }
      json(res, 200, { path: target, content: buf.toString("utf8") });
    },

    "POST /file-save": async (req, res) => {
      const body = await readJsonBody(req, res);
      if (body === undefined) return;
      const target = resolveSafePath(resolve(String(body?.path ?? "")));
      if (!target) { forbidden(res, body?.path); return; }
      if (typeof body?.content !== "string") { json(res, 400, { error: "content must be a string" }); return; }
      let dirOk = false;
      try { dirOk = statSync(dirname(target)).isDirectory(); } catch {}
      if (!dirOk) { json(res, 400, { error: `no such directory: ${dirname(target)}` }); return; }
      const temporary = join(dirname(target), `.${basename(target)}.save-${process.pid}-${Date.now()}`);
      try {
        writeFileSync(temporary, body.content, "utf8");
        renameSync(temporary, target);
      } catch (e) {
        try { unlinkSync(temporary); } catch {}
        json(res, 500, { error: `save failed: ${e.message}` });
        return;
      }
      logger.log(`[pi-ui] file saved via explorer: ${target}`);
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
      const offset = Number(url.searchParams.get("offset") ?? 0);
      const last = url.searchParams.get("last") !== "0"; // default: single-shot = final
      if (!Number.isInteger(offset) || offset < 0) {
        json(res, 400, { error: "invalid offset" });
        return;
      }
      let buf;
      try { buf = await readRawBody(req); } catch (e) { json(res, 413, { error: e.message }); return; }
      const target = join(dir, name);
      const tmp = join(dir, `.${name}.upload`);
      try {
        if (offset === 0) {
          writeFileSync(tmp, buf); // start fresh (truncates any stale partial)
        } else {
          let cur = -1;
          try { cur = statSync(tmp).size; } catch {}
          if (cur === -1 && last) {
            // retried final chunk whose first attempt already renamed the temp file
            let doneSize = -1;
            try { doneSize = statSync(target).size; } catch {}
            if (doneSize === offset + buf.length) {
              json(res, 200, { saved: target, bytes: doneSize });
              return;
            }
          }
          if (cur >= offset + buf.length) {
            // retried chunk that was already applied (response was lost) — idempotent ok
            if (!last) { json(res, 200, { received: cur }); return; }
            // last chunk already appended but not yet renamed: fall through to rename
          } else if (cur !== offset) {
            json(res, 409, { error: `chunk out of sequence: have ${cur} bytes, got offset ${offset}`, have: Math.max(cur, 0) });
            return;
          } else {
            appendFileSync(tmp, buf);
          }
        }
        if (last) renameSync(tmp, target);
      } catch (e) {
        try { unlinkSync(tmp); } catch {}
        json(res, 500, { error: `upload failed: ${e.message}` });
        return;
      }
      if (last) {
        const bytes = statSync(target).size;
        logger.log(`[pi-ui] file uploaded via explorer: ${target} (${bytes} bytes)`);
        json(res, 200, { saved: target, bytes });
      } else {
        json(res, 200, { received: offset + buf.length });
      }
    },

    "POST /mkdir": async (req, res) => {
      const body = await readJsonBody(req, res);
      if (body === undefined) return;
      const parent = resolveSafePath(resolve(String(body?.path ?? "")));
      if (!parent) { forbidden(res, body?.path); return; }
      const name = String(body?.name ?? "").trim();
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
      logger.log(`[pi-ui] created folder ${target}`);
      json(res, 201, { path: target });
    },
  };
}
