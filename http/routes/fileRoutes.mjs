import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const isHidden = (name) => name.startsWith(".");

/** Build confined file-browser routes. */
export function createFileRoutes({ state, requestContext, logger = console }) {
  const { json, readJsonBody, resolveSafePath } = requestContext;
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
